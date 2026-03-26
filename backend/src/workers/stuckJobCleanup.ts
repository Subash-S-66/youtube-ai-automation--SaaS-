import JobModel from '../models/Job';
import { releaseReservedCredits } from '../services/uploadLimitService';

export const recoverCrashedJobs = async () => {
  try {
    const crashedJobs = await JobModel.find({
      status: { $in: ['processing', 'running'] }
    });

    if (crashedJobs.length > 0) {
      console.log(`[CrashRecovery] Found ${crashedJobs.length} stuck jobs from previous runs. Marking failed.`);
      for (const job of crashedJobs) {
        if (!job.holdConsumed && !job.holdReleased) {
           await JobModel.findByIdAndUpdate(job._id, {
               status: 'failed',
               completedAt: new Date(),
               error: 'Server crash during processing',
               holdReleased: true
           });
           await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
        } else {
           await JobModel.findByIdAndUpdate(job._id, {
               status: 'failed',
               completedAt: new Date(),
               error: 'Server crash during processing'
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
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const stuckJobs = await JobModel.find({
        status: { $in: ['processing', 'running'] },
        startedAt: { $lt: tenMinutesAgo }
      });

      if (stuckJobs.length > 0) {
        console.log(`[StuckJobCleanup] Found ${stuckJobs.length} timed-out jobs. Marking failed.`);
        for (const job of stuckJobs) {
          if (!job.holdConsumed && !job.holdReleased) {
             await JobModel.findByIdAndUpdate(job._id, {
                 status: 'failed',
                 completedAt: new Date(),
                 error: 'Job timed out (exceeded 10 mins processing/running limit)',
                 holdReleased: true
             });
             await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
          } else {
             await JobModel.findByIdAndUpdate(job._id, {
                 status: 'failed',
                 completedAt: new Date(),
                 error: 'Job timed out (exceeded 10 mins processing/running limit)'
             });
          }
        }
      }
    } catch (error) {
      console.error('[StuckJobCleanup] Error during stuck job cleanup:', error);
    }
  }, 5 * 60 * 1000);
};
