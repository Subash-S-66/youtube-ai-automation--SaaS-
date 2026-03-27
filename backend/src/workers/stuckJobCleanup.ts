import JobModel from '../models/Job';
import SystemConfig from '../models/SystemConfig';
import { releaseReservedCredits } from '../services/uploadLimitService';
import { calculateJobTimeout } from '../utils/timeoutHelper';
import { pipelineQueue } from '../queues/pipelineQueue';

const MAX_QUEUE_WAIT_TIME = 2 * 60 * 60 * 1000; // 2 hours

export const safelyFailJob = async (job: any, errorMessage: string) => {
  const result = await JobModel.findOneAndUpdate(
    {
      _id: job._id,
      status: { $in: ['processing', 'pending'] } // Ensure it's not already succeeded/failed
    },
    {
      status: 'failed',
      completedAt: new Date(),
      error: errorMessage,
      errorMessage: errorMessage,
      errorStage: 'RENDER',
      holdReleased: true, // we will attempt release below if it was atomic
    },
    { new: true } // Return updated doc
  );

  if (result) {
    if (!job.holdConsumed && !job.holdReleased) {
      await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
    }
  }
};

export const recoverCrashedJobs = async () => {
  try {
    const crashedJobs = await JobModel.find({
      status: 'processing'
    });

    if (crashedJobs.length > 0) {
      console.log(`[CrashRecovery] Found ${crashedJobs.length} stuck jobs from previous runs. Marking failed.`);
      for (const job of crashedJobs) {
        if (!job.holdConsumed && !job.holdReleased) {
           await JobModel.findByIdAndUpdate(job._id, {
               status: 'failed',
               completedAt: new Date(),
               error: 'Server crash during processing',
               errorMessage: 'Server crash during processing',
               errorStage: 'RENDER',
               holdReleased: true
           });
           await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
        } else {
           await JobModel.findByIdAndUpdate(job._id, {
               status: 'failed',
               completedAt: new Date(),
               error: 'Server crash during processing',
               errorMessage: 'Server crash during processing',
               errorStage: 'RENDER',
           });
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

          if (runTime > allowedTime) {
            console.log(`[StuckJobCleanup] Job ${job._id} timed out. Run time: ${runTime}ms, Allowed: ${allowedTime}ms`);
            await safelyFailJob(job, 'Job timed out (dynamic timeout exceeded)');
          }
        } else if (job.status === 'pending' && job.queuedAt) {
          const queueWait = Date.now() - job.queuedAt.getTime();

          if (queueWait > MAX_QUEUE_WAIT_TIME) {
            console.log(`[StuckJobCleanup] Job ${job._id} stuck in queue too long. Wait time: ${queueWait}ms`);
            // Add retry mechanism or fail
            await safelyFailJob(job, 'Job failed (stuck in queue beyond maximum allowed wait time)');
          }
        }
      }
    } catch (error) {
      console.error('[StuckJobCleanup] Error during stuck job cleanup:', error);
    }
  }, 5 * 60 * 1000);
};
