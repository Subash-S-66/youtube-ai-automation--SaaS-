import { Queue } from 'bullmq';
import { connection } from '../config/redis';

// Define the payload structure for our pipeline jobs
export interface PipelineJobPayload {
  userId: string;
  promptId: string;
  jobId: string; // The MongoDB Job Document ID
  settings: Record<string, any>;
}

// Create and export the queue
export const pipelineQueue = new Queue<PipelineJobPayload>('pipelineQueue', {
  connection: connection as any, // Cast to any to bypass strict type matching between different ioredis versions installed
});
