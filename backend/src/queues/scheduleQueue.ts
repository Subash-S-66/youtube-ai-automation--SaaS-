import { Queue } from 'bullmq';
import { connection, redisEnabled } from '../config/redis';
import { NoopQueue } from './noopQueue';

export interface ScheduleJobPayload {
  scheduleId: string;
}

export const scheduleQueue = redisEnabled && connection
  ? new Queue<ScheduleJobPayload>('scheduleQueue', {
      connection: connection as any,
    })
  : (new NoopQueue('scheduleQueue') as any);
