import { Queue } from 'bullmq';
import { connection, redisEnabled } from '../config/redis';
import { NoopQueue } from './noopQueue';

export const dailyResetQueue = redisEnabled && connection
  ? new Queue('dailyResetQueue', { connection: connection as any })
  : (new NoopQueue('dailyResetQueue') as any);

export const scheduleDailyReset = async () => {
  if (redisEnabled && connection) {
    // Run at midnight UTC every day
    await dailyResetQueue.add(
      'dailyUserReset',
      {},
      {
        repeat: {
          pattern: '0 0 * * *', // Cron format: 00:00 UTC daily
        },
        jobId: 'daily-reset-job' // Ensure only one repeatable job exists
      }
    );
  }
};
