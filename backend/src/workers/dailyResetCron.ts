import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import User from '../models/User';

let worker: Worker | null = null;

export const startDailyResetWorker = () => {
  console.log('[DailyResetCron] Starting worker for daily reset');

  worker = new Worker(
    'dailyResetQueue',
    async () => {
      console.log('[DailyResetCron] Executing daily user reset...');
      try {
        const now = new Date();
        const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

        const result = await User.updateMany(
          { lastUploadReset: { $lt: startOfUTCDay } },
          {
            $set: {
              uploadsUsedToday: 0,
              uploadsOnHold: 0,
              lastUploadReset: now
            }
          }
        );
        console.log(`[DailyResetCron] Reset completed for ${result.modifiedCount} users.`);
      } catch (error) {
        console.error('[DailyResetCron] Error during daily reset:', error);
      }
    },
    { connection: connection as any }
  );

  worker.on('failed', (job, err) => {
    console.error(`[DailyResetCron] Job failed:`, err);
  });
};
