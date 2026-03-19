import { Queue } from 'bullmq';
import { connection, redisEnabled } from '../config/redis';
import { NoopQueue } from './noopQueue';

// Define the payload structure for our pipeline jobs
export interface PipelineJobPayload {
  userId: string;
  promptId: string;
  jobId: string; // The MongoDB Job Document ID
  settings: Record<string, any>; // Includes videoCount and channelId
}

// Create and export the queue
export const pipelineQueue = redisEnabled && connection
  ? new Queue<PipelineJobPayload>('pipelineQueue', {
      connection: connection as any, // Cast to any to bypass strict type matching between different ioredis versions installed
    })
  : (new NoopQueue('pipelineQueue') as any);
