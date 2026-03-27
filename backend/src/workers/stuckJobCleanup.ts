import JobModel from '../models/Job';
import { releaseReservedCredits } from '../services/uploadLimitService';
import { pipelineQueue } from '../queues/pipelineQueue';

export const recoverCrashedJobs = async () => {
  try {
    const crashedJobs = await JobModel.find({
      status: 'processing'
    });

    if (crashedJobs.length > 0) {
      console.log(`[CrashRecovery] Found ${crashedJobs.length} stuck jobs from previous runs. Marking failed.`);
      for (const job of crashedJobs) {
        const updatedJob = await JobModel.findOneAndUpdate(
            { _id: job._id, holdConsumed: false, holdReleased: false },
            {
                $set: {
                    status: 'failed',
                    completedAt: new Date(),
                    error: 'Server crash during processing',
                    errorMessage: 'Server crash during processing',
                    errorStage: 'RENDER',
                    holdReleased: true
                }
            },
            { new: true }
        );
        if (updatedJob) {
           await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
        } else {
           console.log(`[CrashRecovery] Job ${job._id} was already processed (holds handled) by another routine.`);
        }
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
      await reconcileQueueWithDatabase();

      const threshold = Number(process.env.STUCK_JOB_THRESHOLD_MS || 60 * 60 * 1000); // Max pipeline duration
      const staleTime = new Date(Date.now() - threshold);
      const stuckJobs = await JobModel.find({
        status: 'processing',
        executionLockedAt: { $lt: staleTime }
      });

      if (stuckJobs.length > 0) {
        console.log(`[StuckJobCleanup] Found ${stuckJobs.length} timed-out jobs. Marking failed.`);
        for (const job of stuckJobs) {
          const updatedJob = await JobModel.findOneAndUpdate(
              { _id: job._id, holdConsumed: false, holdReleased: false },
              {
                  $set: {
                      status: 'failed',
                      completedAt: new Date(),
                      error: 'Job timed out (stuck in processing beyond threshold)',
                      errorMessage: 'Job timed out (stuck in processing beyond threshold)',
                      errorStage: 'RENDER',
                      holdReleased: true
                  }
              },
              { new: true }
          );
          if (updatedJob) {
             await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
          } else {
             console.log(`[StuckJobCleanup] Job ${job._id} was already processed (holds handled) by another routine.`);
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
              attempts: 3,
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
