import { Queue } from 'bullmq';
import { connection } from '../config/redis';

// Define the payload structure for email broadcasting
export interface EmailJobPayload {
  to: string;
  subject: string;
  message: string;
}

// Create and export the queue
export const emailQueue = new Queue<EmailJobPayload>('emailQueue', {
  connection: connection as any,
});
