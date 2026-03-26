import JobModel from '../models/Job';
import { releaseReservedCredits } from '../services/uploadLimitService';

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
      const threshold = Number(process.env.STUCK_JOB_THRESHOLD_MS || 15 * 60 * 1000);
      const staleTime = new Date(Date.now() - threshold);
      const stuckJobs = await JobModel.find({
        status: 'processing',
        executionLockedAt: { $lt: staleTime }
      });

      if (stuckJobs.length > 0) {
        console.log(`[StuckJobCleanup] Found ${stuckJobs.length} timed-out jobs. Marking failed.`);
        for (const job of stuckJobs) {
          if (!job.holdConsumed && !job.holdReleased) {
             await JobModel.findByIdAndUpdate(job._id, {
                 status: 'failed',
                 completedAt: new Date(),
                 error: 'Job timed out (stuck in processing beyond threshold)',
                 errorMessage: 'Job timed out (stuck in processing beyond threshold)',
                 errorStage: 'RENDER',
                 holdReleased: true
             });
             await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
          } else {
             await JobModel.findByIdAndUpdate(job._id, {
                 status: 'failed',
                 completedAt: new Date(),
                 error: 'Job timed out (stuck in processing beyond threshold)',
                 errorMessage: 'Job timed out (stuck in processing beyond threshold)',
                 errorStage: 'RENDER',
             });
          }
        }
      }
    } catch (error) {
      console.error('[StuckJobCleanup] Error during stuck job cleanup:', error);
    }
  }, 5 * 60 * 1000);
};
