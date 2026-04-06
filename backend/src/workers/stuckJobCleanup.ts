import JobModel from '../models/Job';
import SystemConfig from '../models/SystemConfig';
import { releaseReservedCredits } from '../services/uploadLimitService';
import { calculateJobTimeout } from '../utils/timeoutHelper';
import { pipelineQueue } from '../queues/pipelineQueue';
import { decrementChannelVideosOnHold, resolveJobChannelId } from '../services/channelHoldService';
import {
  buildRunnerSequence,
  getMinimumAttemptsForRunnerCycles,
  getPipelineAttemptsForPlan,
  sanitizePipelineCycleAcrossRunners,
  sanitizePipelineRetryCycles,
  sanitizePipelineRunnerFallbackOrder,
} from '../services/pipelineRetryPolicyService';
import { applyUserJobHistoryRetention } from '../services/jobHistoryRetentionPolicyService';
import { acquireLock, releaseLock } from '../utils/redisLock';

type RecoverableJobStatus = 'processing' | 'pending';

const MINUTE_MS = 60 * 1000;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MINUTES = 100;
const DEFAULT_PROCESSING_HARD_TIMEOUT_MINUTES = 100;
const MIN_QUEUE_WAIT_TIMEOUT_MINUTES = 5;
const MAX_QUEUE_WAIT_TIMEOUT_MINUTES = 1440;
const MIN_PROCESSING_HARD_TIMEOUT_MINUTES = 10;
const MAX_PROCESSING_HARD_TIMEOUT_MINUTES = 1440;
const RECOVERY_REQUEUE_GRACE_MS = 5 * 60 * 1000;
const CRASH_RECOVERY_LOCK_KEY = 'lock:stuck-job-cleanup:recover';
const CRASH_RECOVERY_LOCK_TTL_SECONDS = 120;
const STUCK_CLEANUP_INTERVAL_LOCK_KEY = 'lock:stuck-job-cleanup:interval';
const STUCK_CLEANUP_INTERVAL_LOCK_TTL_SECONDS = 4 * 60;

const getRequestedUploadCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
};

const asValidDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const getQueueReferenceTime = (job: any): Date | null => {
  return asValidDate(job.queuedAt) || asValidDate(job.updatedAt) || asValidDate(job.createdAt);
};

const sanitizeMinutes = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
};

const normalizeRunner = (value: unknown): 'local' | 'azure' | 'remote' | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'azure' || normalized === 'remote') {
    return normalized;
  }
  return null;
};

const resolveQueueAttemptBudgetForPlan = (plan: string, config: any): number => {
  const baseAttempts = getPipelineAttemptsForPlan(plan, config as any);
  const fallbackOrder = sanitizePipelineRunnerFallbackOrder(config?.pipelineRunnerFallbackOrder);
  const configPrimary = normalizeRunner(config?.pipelineRunner);
  const envPrimary = normalizeRunner(process.env.PIPELINE_RUNNER);
  const pinnedByEnv = parseBoolean(process.env.PIPELINE_RUNNER_PINNED, false);
  const effectivePinned = typeof config?.pipelineRunnerPinned === 'boolean'
    ? config.pipelineRunnerPinned
    : pinnedByEnv;
  const remoteConfigured = Boolean(String(config?.pipelineServiceUrl || process.env.PIPELINE_SERVICE_URL || '').trim());
  const autoPrimary: 'local' | 'remote' = remoteConfigured ? 'remote' : 'local';
  const effectivePrimary: 'local' | 'azure' | 'remote' = effectivePinned
    ? (envPrimary || configPrimary || autoPrimary)
    : (configPrimary || envPrimary || autoPrimary);
  const runnerSequence = buildRunnerSequence(effectivePrimary, fallbackOrder);
  const retryCycles = sanitizePipelineRetryCycles(config?.pipelineRetryCycles);
  const cycleAcrossRunners = sanitizePipelineCycleAcrossRunners(config?.pipelineCycleAcrossRunners, true);
  const minimumCycleAttempts = cycleAcrossRunners
    ? getMinimumAttemptsForRunnerCycles(runnerSequence.length, retryCycles)
    : 1;
  return Math.max(1, Math.max(baseAttempts, minimumCycleAttempts));
};

type CleanupTimeoutPolicy = {
  queueWaitTimeoutMinutes: number;
  queueWaitTimeoutMs: number;
  processingHardTimeoutMinutes: number;
  processingHardTimeoutMs: number;
};

const resolveCleanupTimeoutPolicy = (systemConfig: any): CleanupTimeoutPolicy => {
  const queueWaitTimeoutMinutes = sanitizeMinutes(
    systemConfig?.queueWaitTimeoutMinutes,
    DEFAULT_QUEUE_WAIT_TIMEOUT_MINUTES,
    MIN_QUEUE_WAIT_TIMEOUT_MINUTES,
    MAX_QUEUE_WAIT_TIMEOUT_MINUTES
  );
  const processingHardTimeoutMinutes = sanitizeMinutes(
    systemConfig?.processingHardTimeoutMinutes,
    DEFAULT_PROCESSING_HARD_TIMEOUT_MINUTES,
    MIN_PROCESSING_HARD_TIMEOUT_MINUTES,
    MAX_PROCESSING_HARD_TIMEOUT_MINUTES
  );

  return {
    queueWaitTimeoutMinutes,
    queueWaitTimeoutMs: queueWaitTimeoutMinutes * MINUTE_MS,
    processingHardTimeoutMinutes,
    processingHardTimeoutMs: processingHardTimeoutMinutes * MINUTE_MS,
  };
};

const getQueueTimeoutError = (queueWaitTimeoutMinutes: number): string =>
  `Queue timeout: job waited more than ${queueWaitTimeoutMinutes} minutes before processing.`;

const getProcessingHardTimeoutError = (processingHardTimeoutMinutes: number): string =>
  `Job timed out after running more than ${processingHardTimeoutMinutes} minutes.`;

const PIPELINE_QUEUE_CLEANUP_STATES: Array<'waiting' | 'delayed' | 'prioritized' | 'paused'> = [
  'waiting',
  'delayed',
  'prioritized',
  'paused',
];

const getDbJobIdFromQueueEntry = (queueEntry: any): string => {
  const entryJobId = queueEntry?.data?.jobId;
  if (typeof entryJobId === 'string' && entryJobId.trim()) {
    return entryJobId.trim();
  }
  if (entryJobId != null) {
    return String(entryJobId).trim();
  }
  return '';
};

const removeQueuedPipelineEntriesForDbJob = async (dbJobId: string): Promise<number> => {
  if (!dbJobId || !pipelineQueue || typeof (pipelineQueue as any).getJobs !== 'function') {
    return 0;
  }

  const candidates: any[] = [];
  try {
    const queuedEntries = await (pipelineQueue as any).getJobs(PIPELINE_QUEUE_CLEANUP_STATES);
    if (Array.isArray(queuedEntries)) {
      candidates.push(...queuedEntries);
    }
  } catch (error) {
    console.warn(`[StuckJobCleanup] Failed to scan queue states while cleaning job ${dbJobId}:`, error);
  }

  if (typeof (pipelineQueue as any).getJob === 'function') {
    try {
      const directEntry = await (pipelineQueue as any).getJob(dbJobId);
      if (directEntry) {
        candidates.push(directEntry);
      }
    } catch (error) {
      console.warn(`[StuckJobCleanup] Failed to fetch direct queue entry for job ${dbJobId}:`, error);
    }
  }

  const matchingEntries = new Map<string, any>();
  for (const entry of candidates) {
    const queueId = String(entry?.id || '').trim();
    if (!queueId) {
      continue;
    }
    const mappedDbJobId = getDbJobIdFromQueueEntry(entry);
    if (mappedDbJobId === dbJobId || queueId === dbJobId) {
      matchingEntries.set(queueId, entry);
    }
  }

  let removedCount = 0;
  for (const entry of matchingEntries.values()) {
    try {
      await entry.remove();
      removedCount += 1;
    } catch (error) {
      console.warn(`[StuckJobCleanup] Failed to remove queue entry ${String(entry?.id || 'unknown')} for job ${dbJobId}:`, error);
    }
  }

  return removedCount;
};

const cleanupQueueEntriesAfterFailure = async (dbJobId: string, reason: string): Promise<void> => {
  const removedCount = await removeQueuedPipelineEntriesForDbJob(dbJobId);
  if (removedCount > 0) {
    console.log(`[StuckJobCleanup] Removed ${removedCount} BullMQ queued entries for job ${dbJobId} (${reason}).`);
  }
};

export const safelyFailJob = async (
  job: any,
  errorMessage: string,
  allowedStatuses: RecoverableJobStatus[] = ['processing', 'pending'],
  options?: {
    queueWaitTimeoutMinutes?: number;
  }
): Promise<boolean> => {
  const requestedCount = getRequestedUploadCount(job.videoCount || 1);
  const existingLogs = typeof job.logs === 'string' ? job.logs : '';
  const timeoutLog = options?.queueWaitTimeoutMinutes
    ? `[Timeout] Job terminated after waiting in queue for more than ${options.queueWaitTimeoutMinutes} minutes.\n`
    : '';
  const result = await JobModel.findOneAndUpdate(
    {
      _id: job._id,
      status: { $in: allowedStatuses },
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
    await applyUserJobHistoryRetention(job.userId.toString()).catch((error) => {
      console.warn(`[StuckJobCleanup] Failed to apply job history retention for user ${job.userId}:`, error);
    });
    return true;
  }

  // Keep status consistent even if holds were already settled by a parallel path.
  try {
    const fallbackResult = await JobModel.updateOne(
      { _id: job._id, status: { $in: allowedStatuses } },
      {
        $set: {
          status: 'failed',
          completedAt: new Date(),
          error: errorMessage,
          errorMessage,
          errorStage: 'RENDER',
        },
      }
    );
    if (fallbackResult.modifiedCount > 0) {
      await applyUserJobHistoryRetention(job.userId.toString()).catch((error) => {
        console.warn(`[StuckJobCleanup] Failed to apply job history retention for user ${job.userId}:`, error);
      });
    }
    return fallbackResult.modifiedCount > 0;
  } catch (error) {
    console.error(error);
    return false;
  }
};

export const recoverCrashedJobs = async () => {
  const acquired = await acquireLock(CRASH_RECOVERY_LOCK_KEY, CRASH_RECOVERY_LOCK_TTL_SECONDS);
  if (!acquired) {
    console.log('[CrashRecovery] Skipped (another process is running startup crash recovery).');
    return;
  }

  try {
    const systemConfig = await SystemConfig.findOne().sort({ updatedAt: -1 });
    const cleanupPolicy = resolveCleanupTimeoutPolicy(systemConfig);
    const queueTimeoutError = getQueueTimeoutError(cleanupPolicy.queueWaitTimeoutMinutes);

    const crashedJobs = await JobModel.find({
      status: 'processing'
    });

    if (crashedJobs.length > 0) {
      console.log(`[CrashRecovery] Found ${crashedJobs.length} processing jobs from previous runs. Reconciling state...`);
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
                const jobAttempts = resolveQueueAttemptBudgetForPlan(planName, systemConfig as any);

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
        const markedFailed = await safelyFailJob(job, 'Server crash during processing', ['processing']);
        if (markedFailed) {
          await cleanupQueueEntriesAfterFailure(job._id.toString(), 'startup-processing-timeout');
        }
      }
    }

    const pendingJobs = await JobModel.find({
      status: 'pending',
    });

    let startupQueueTimeoutCount = 0;
    for (const job of pendingJobs) {
      const queueReferenceTime = getQueueReferenceTime(job);
      if (!queueReferenceTime) {
        continue;
      }

      const queueWait = Date.now() - queueReferenceTime.getTime();
      if (queueWait <= cleanupPolicy.queueWaitTimeoutMs) {
        continue;
      }

      console.log(
        `[CrashRecovery] Terminating stale queued job ${job._id}. Wait time: ${queueWait}ms (limit: ${cleanupPolicy.queueWaitTimeoutMs}ms)`
      );
      const markedFailed = await safelyFailJob(job, queueTimeoutError, ['pending'], {
        queueWaitTimeoutMinutes: cleanupPolicy.queueWaitTimeoutMinutes,
      });
      if (markedFailed) {
        startupQueueTimeoutCount += 1;
        await cleanupQueueEntriesAfterFailure(job._id.toString(), 'startup-queue-timeout');
      }
    }

    if (startupQueueTimeoutCount > 0) {
      console.log(
        `[CrashRecovery] Marked ${startupQueueTimeoutCount} queued jobs as failed because they exceeded ${cleanupPolicy.queueWaitTimeoutMinutes} minutes.`
      );
    }
  } catch (error) {
    console.error('[CrashRecovery] Error recovering crashed jobs:', error);
  } finally {
    await releaseLock(CRASH_RECOVERY_LOCK_KEY).catch(() => {
      // best-effort lock cleanup
    });
  }
};

export const startStuckJobCleanupInterval = () => {
  // Run every 5 minutes
  setInterval(async () => {
    const acquired = await acquireLock(STUCK_CLEANUP_INTERVAL_LOCK_KEY, STUCK_CLEANUP_INTERVAL_LOCK_TTL_SECONDS);
    if (!acquired) {
      return;
    }

    try {
      // Fetch dynamic configuration
      let systemConfig = await SystemConfig.findOne().sort({ updatedAt: -1 });
      const cleanupPolicy = resolveCleanupTimeoutPolicy(systemConfig);
      const queueTimeoutError = getQueueTimeoutError(cleanupPolicy.queueWaitTimeoutMinutes);
      const processingHardTimeoutError = getProcessingHardTimeoutError(cleanupPolicy.processingHardTimeoutMinutes);
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
          const hardTimeoutExceeded = runTime > cleanupPolicy.processingHardTimeoutMs;

          if (runTime > allowedTime || hardTimeoutExceeded) {
            console.log(`[StuckJobCleanup] Job ${job._id} timed out. Run time: ${runTime}ms, Allowed: ${allowedTime}ms`);
            const markedFailed = await safelyFailJob(
              job,
              hardTimeoutExceeded
                ? processingHardTimeoutError
                : 'Job timed out (dynamic timeout exceeded)',
              ['processing']
            );
            if (markedFailed) {
              await cleanupQueueEntriesAfterFailure(job._id.toString(), 'interval-processing-timeout');
            }
          }
        } else if (job.status === 'processing' && !job.startedAt) {
          const staleSince =
            job.executionLockedAt instanceof Date
              ? job.executionLockedAt
              : (job.updatedAt instanceof Date ? job.updatedAt : (job.createdAt instanceof Date ? job.createdAt : null));
          if (staleSince) {
            const processingAge = Date.now() - staleSince.getTime();
            if (processingAge > cleanupPolicy.processingHardTimeoutMs) {
              console.log(
                `[StuckJobCleanup] Job ${job._id} has no startedAt and exceeded ${cleanupPolicy.processingHardTimeoutMinutes} minutes in processing.`
              );
              const markedFailed = await safelyFailJob(job, processingHardTimeoutError, ['processing']);
              if (markedFailed) {
                await cleanupQueueEntriesAfterFailure(job._id.toString(), 'interval-processing-no-startedAt-timeout');
              }
            }
          }
        } else if (job.status === 'pending') {
          const queueReferenceTime = getQueueReferenceTime(job);
          if (!queueReferenceTime) {
            continue;
          }

          const queueWait = Date.now() - queueReferenceTime.getTime();

          if (queueWait > cleanupPolicy.queueWaitTimeoutMs) {
            console.log(`[StuckJobCleanup] Job ${job._id} stuck in queue too long. Wait time: ${queueWait}ms`);
            const markedFailed = await safelyFailJob(job, queueTimeoutError, ['pending'], {
              queueWaitTimeoutMinutes: cleanupPolicy.queueWaitTimeoutMinutes,
            });
            if (markedFailed) {
              await cleanupQueueEntriesAfterFailure(job._id.toString(), 'interval-queue-timeout');
            }
          }
        }
      }
    } catch (error) {
      console.error('[StuckJobCleanup] Error during stuck job cleanup:', error);
    } finally {
      await releaseLock(STUCK_CLEANUP_INTERVAL_LOCK_KEY).catch(() => {
        // best-effort lock cleanup
      });
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
