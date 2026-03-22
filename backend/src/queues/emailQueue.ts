import { Queue } from 'bullmq';
import { connection, redisEnabled } from '../config/redis';
import { NoopQueue } from './noopQueue';

// Define the payload structure for email broadcasting
export interface EmailJobPayload {
  to: string;
  subject: string;
  message: string;
}

// Create and export the queue
export const emailQueue = redisEnabled && connection
  ? new Queue<EmailJobPayload>('emailQueue', {
      connection: connection as any,
    })
  : (new NoopQueue('emailQueue') as any);
