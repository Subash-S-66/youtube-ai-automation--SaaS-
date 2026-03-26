import { Worker, Job } from 'bullmq';
import { connection } from '../config/redis';
import { sendEmail } from '../services/emailService';
import { EmailJobPayload } from '../queues/emailQueue';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars if running independently
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('[EmailWorker] MongoDB connected');
  } catch (error) {
    console.error('[EmailWorker] MongoDB connection error:', error);
    process.exit(1);
  }
};

const processEmailJob = async (job: Job<EmailJobPayload>) => {
  const { to, subject, message } = job.data;
  console.log(`[EmailWorker] Processing email job for ${to}`);
  try {
    // sendEmail handles its own retries, but we could also rely on BullMQ retries
    await sendEmail(to, subject, message, undefined, 2);
    console.log(`[EmailWorker] Successfully processed email for ${to}`);
    return { success: true };
  } catch (error: any) {
    console.error(`[EmailWorker] Error processing email job for ${to}:`, error.message);
    throw error;
  }
};

const startWorker = async () => {
  await connectDB();

  // Rate limited worker to avoid spamming the SMTP server
  const worker = new Worker<EmailJobPayload>(
    'emailQueue',
    processEmailJob,
    {
      connection: connection as any,
      concurrency: 5, // Process up to 5 emails concurrently
      limiter: {
        max: 50, // 50 jobs
        duration: 10000, // per 10 seconds
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[EmailWorker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[EmailWorker] Job ${job?.id} failed with error ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error(`[EmailWorker] BullMQ Worker Error:`, err);
  });

  console.log('[EmailWorker] Started listening for jobs...');

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[EmailWorker] Received ${signal}, closing worker...`);
    await worker.close();
    await mongoose.connection.close();
    console.log('[EmailWorker] Worker closed gracefully.');
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
};

startWorker().catch(console.error);
