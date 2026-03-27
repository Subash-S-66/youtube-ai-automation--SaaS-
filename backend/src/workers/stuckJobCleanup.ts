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
          console.log(`[Reconciliation] Job ${job._id} is pending in DB but missing from Queue. Re-enqueueing or failing...`);
          // Mark it as failed since it was lost
          const updatedJob = await JobModel.findOneAndUpdate(
              { _id: job._id, status: 'pending', holdConsumed: false, holdReleased: false },
              {
                  $set: {
                      status: 'failed',
                      completedAt: new Date(),
                      error: 'Job lost from queue, marked failed by reconciler',
                      errorMessage: 'Job lost from queue, marked failed by reconciler',
                      errorStage: 'RENDER',
                      holdReleased: true
                  }
              },
              { new: true }
          );
          if (updatedJob) {
             await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
          }
        }
      } catch (err) {
        console.error(`[Reconciliation] Error checking job ${job._id} in queue:`, err);
      }
    }
  } catch (err) {
    console.error(`[Reconciliation] Failed to run:`, err);
  }
};
