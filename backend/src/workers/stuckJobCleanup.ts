import JobModel from '../models/Job';
import SystemConfig from '../models/SystemConfig';
import { releaseReservedCredits } from '../services/uploadLimitService';
import { calculateJobTimeout } from '../utils/timeoutHelper';
import { pipelineQueue } from '../queues/pipelineQueue';
import { decrementChannelVideosOnHold, resolveJobChannelId } from '../services/channelHoldService';
import { getPipelineAttemptsForPlan } from '../services/pipelineRetryPolicyService';

const MAX_QUEUE_WAIT_TIME = 2 * 60 * 60 * 1000; // 2 hours
const MAX_PROCESSING_RUNTIME_MS = 2 * 60 * 60 * 1000; // 2 hours hard cap for active processing
const QUEUE_TIMEOUT_ERROR = 'Queue timeout: job waited more than 2 hours before processing.';
const RECOVERY_REQUEUE_GRACE_MS = 5 * 60 * 1000;

const getRequestedUploadCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
};

export const safelyFailJob = async (job: any, errorMessage: string) => {
  const requestedCount = getRequestedUploadCount(job.videoCount || 1);
  const existingLogs = typeof job.logs === 'string' ? job.logs : '';
  const timeoutLog =
    errorMessage === QUEUE_TIMEOUT_ERROR
      ? `[Timeout] Job terminated after waiting in queue for more than 2 hours.\n`
      : '';
  const result = await JobModel.findOneAndUpdate(
    {
      _id: job._id,
      status: { $in: ['processing', 'pending'] },
      holdConsumed: false,
      holdReleased: false,
    },
    {
      status: 'failed',
      completedAt: new Date(),
      error: errorMessage,
      errorMessage: errorMessage,
      errorStage: 'RENDER',
      logs: `${existingLogs}${timeoutLog}`,
      holdConsumed: false,
      holdReleased: true,
      processedVideos: 0,
    },
    { returnDocument: 'after' } // Return updated doc
  );

  if (result) {
    await releaseReservedCredits(job.userId.toString(), requestedCount).catch(console.error);
    const channelId = resolveJobChannelId(job);
    if (channelId) {
      await decrementChannelVideosOnHold(job.userId.toString(), channelId, requestedCount).catch(console.error);
    }
    return;
  }

  // Keep status consistent even if holds were already settled by a parallel path.
  await JobModel.updateOne(
    { _id: job._id, status: { $in: ['processing', 'pending'] } },
    {
      $set: {
        status: 'failed',
        completedAt: new Date(),
        error: errorMessage,
        errorMessage,
        errorStage: 'RENDER',
      },
    }
  ).catch(console.error);
};

export const recoverCrashedJobs = async () => {
  try {
    const crashedJobs = await JobModel.find({
      status: 'processing'
    });

    if (crashedJobs.length > 0) {
      console.log(`[CrashRecovery] Found ${crashedJobs.length} processing jobs from previous runs. Reconciling state...`);
      const systemConfig = await SystemConfig.findOne().sort({ updatedAt: -1 });
      const timeoutConfig = {
        baseTimeoutMs: systemConfig?.baseTimeoutMs || 2 * 60 * 1000,
        perVideoTimeoutMs: systemConfig?.perVideoTimeoutMs || 6 * 60 * 1000,
      };

      for (const job of crashedJobs) {
        const startedAt = job.startedAt instanceof Date ? job.startedAt : null;
        const runTime = startedAt ? Date.now() - startedAt.getTime() : Number.MAX_SAFE_INTEGER;
        const allowedTime = calculateJobTimeout(job.videoCount || 1, timeoutConfig, job.processedVideos || 0);
        const shouldRequeue = Boolean(startedAt && runTime <= (allowedTime + RECOVERY_REQUEUE_GRACE_MS));

        if (shouldRequeue) {
          const requeued = await JobModel.findOneAndUpdate(
            { _id: job._id, status: 'processing' },
            {
              $set: {
                status: 'pending',
                queuedAt: new Date(),
              },
              $unset: {
                startedAt: '',
                executionLockedAt: '',
                completedAt: '',
                error: '',
                errorMessage: '',
                errorStage: '',
              },
            },
            { new: true }
          );

          if (requeued) {
            try {
              const existingBullJob = await pipelineQueue.getJob(job._id.toString());
              if (!existingBullJob) {
                const planPriorities: Record<string, number> = {
                  premium: 1,
                  pro: 2,
                  basic: 3,
                  free: 4,
                };
                const jobPriority = planPriorities[job.pipelineConfig?.plan || 'free'] || 4;
                const count = job.videoCount || 1;
                const jobTimeoutMinutes = 10 + (count - 1) * 5;
                const jobTimeoutMs = jobTimeoutMinutes * 60 * 1000;
                const planName = String(job.pipelineConfig?.plan || 'free').toLowerCase();
                const jobAttempts = getPipelineAttemptsForPlan(planName, systemConfig as any);

                await pipelineQueue.add(
                  'runPipeline',
                  {
                    userId: job.userId.toString(),
                    promptId: job.promptId.toString(),
                    jobId: job._id.toString(),
                    settings: job.pipelineConfig,
                  },
                  {
                    priority: jobPriority,
                    jobId: job._id.toString(),
                    attempts: jobAttempts,
                    timeout: jobTimeoutMs,
                    backoff: {
                      type: 'exponential',
                      delay: 5000,
                    },
                  }
                );
              }
              console.log(`[CrashRecovery] Re-queued recent processing job ${job._id}.`);
            } catch (requeueError) {
              console.error(`[CrashRecovery] Failed to re-queue job ${job._id}:`, requeueError);
            }
          }
          continue;
        }

        console.log(
          `[CrashRecovery] Marking stale job ${job._id} as failed. Runtime=${runTime}ms allowed=${allowedTime}ms`
        );
        await safelyFailJob(job, 'Server crash during processing');
      }
    }
  } catch (error) {
    console.error('[CrashRecovery] Error recovering crashed jobs:', error);
  }
};

export const startStuckJobCleanupInterval = () => {
  // Run every 5 minutes
  setInterval(async () => {
    try {
      // Fetch dynamic configuration
      let systemConfig = await SystemConfig.findOne().sort({ updatedAt: -1 });
      const config = {
        baseTimeoutMs: systemConfig?.baseTimeoutMs || 2 * 60 * 1000,
        perVideoTimeoutMs: systemConfig?.perVideoTimeoutMs || 6 * 60 * 1000,
      };

      const allActiveJobs = await JobModel.find({
        status: { $in: ['processing', 'pending'] }
      });

      for (const job of allActiveJobs) {
        if (job.status === 'processing' && job.startedAt) {
          const runTime = Date.now() - job.startedAt.getTime();
          const allowedTime = calculateJobTimeout(job.videoCount || 1, config, job.processedVideos || 0);
          const hardTimeoutExceeded = runTime > MAX_PROCESSING_RUNTIME_MS;

          if (runTime > allowedTime || hardTimeoutExceeded) {
            console.log(`[StuckJobCleanup] Job ${job._id} timed out. Run time: ${runTime}ms, Allowed: ${allowedTime}ms`);
            await safelyFailJob(
              job,
              hardTimeoutExceeded
                ? 'Job timed out after running more than 2 hours.'
                : 'Job timed out (dynamic timeout exceeded)'
            );
          }
        } else if (job.status === 'processing' && !job.startedAt) {
          const staleSince =
            job.executionLockedAt instanceof Date
              ? job.executionLockedAt
              : (job.updatedAt instanceof Date ? job.updatedAt : (job.createdAt instanceof Date ? job.createdAt : null));
          if (staleSince) {
            const processingAge = Date.now() - staleSince.getTime();
            if (processingAge > MAX_PROCESSING_RUNTIME_MS) {
              console.log(
                `[StuckJobCleanup] Job ${job._id} has no startedAt and exceeded 2 hours in processing.`
              );
              await safelyFailJob(job, 'Job timed out after running more than 2 hours.');
            }
          }
        } else if (job.status === 'pending' && job.queuedAt) {
          const queueWait = Date.now() - job.queuedAt.getTime();

          if (queueWait > MAX_QUEUE_WAIT_TIME) {
            console.log(`[StuckJobCleanup] Job ${job._id} stuck in queue too long. Wait time: ${queueWait}ms`);
            // Add retry mechanism or fail
            await safelyFailJob(job, QUEUE_TIMEOUT_ERROR);
          }
        }
      }
    } catch (error) {
      console.error('[StuckJobCleanup] Error during stuck job cleanup:', error);
    }
  }, 5 * 60 * 1000);
};

export const reconcileQueueWithDatabase = async () => {
  try {
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
    const systemConfig = await SystemConfig.findOne().sort({ updatedAt: -1 }).select('pipelineRetriesByPlan');
    const pendingJobs = await JobModel.find({
      status: 'pending',
      createdAt: { $lt: tenMinsAgo }
    });

    for (const job of pendingJobs) {
      try {
        const bullJob = await pipelineQueue.getJob(job._id.toString());
        if (!bullJob) {
          console.log(`[Reconciliation] Job ${job._id} is pending in DB but missing from Queue. Re-enqueueing...`);

          const planPriorities: Record<string, number> = {
            premium: 1,
            pro: 2,
            basic: 3,
            free: 4,
          };
          const jobPriority = planPriorities[job.pipelineConfig?.plan || 'free'] || 4;
          const count = job.videoCount || 1;
          const jobTimeoutMinutes = 10 + (count - 1) * 5;
          const jobTimeoutMs = jobTimeoutMinutes * 60 * 1000;
          const planName = String(job.pipelineConfig?.plan || 'free').toLowerCase();
          const jobAttempts = getPipelineAttemptsForPlan(planName, systemConfig as any);

          await pipelineQueue.add(
            'runPipeline',
            {
              userId: job.userId.toString(),
              promptId: job.promptId.toString(),
              jobId: job._id.toString(),
              settings: job.pipelineConfig,
            },
            {
              priority: jobPriority,
              jobId: job._id.toString(),
              attempts: jobAttempts,
              timeout: jobTimeoutMs,
              backoff: {
                type: 'exponential',
                delay: 5000,
              },
            }
          );
        }
      } catch (err) {
        console.error(`[Reconciliation] Error checking job ${job._id} in queue:`, err);
      }
    }
  } catch (err) {
    console.error(`[Reconciliation] Failed to run:`, err);
  }
};
