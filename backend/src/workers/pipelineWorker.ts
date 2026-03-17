import { Worker, Job as BullJob } from 'bullmq';
import { spawn } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import { connection } from '../config/redis';
import JobModel from '../models/Job';
import User from '../models/User';
import Prompt from '../models/Prompt';
import { getValidYouTubeToken } from '../services/youtubeTokenService';
import { PipelineJobPayload } from '../queues/pipelineQueue';
import { incrementUploadCount } from '../services/uploadLimitService';
import { notifyUser } from '../services/notificationService';

// Load env vars
dotenv.config();

// Connect to MongoDB BEFORE starting worker
connectDB();

console.log('Worker is starting and connected to Redis/MongoDB...');

const MAX_LOG_SIZE = 100 * 1024; // Limit log to 100 KB

const appendLogSafe = (currentLogs: string, newText: string): string => {
  let combined = currentLogs + newText;
  if (combined.length > MAX_LOG_SIZE) {
    // Keep the last MAX_LOG_SIZE characters, optionally adding a truncation notice
    combined = '...[LOGS TRUNCATED]...\n' + combined.substring(combined.length - MAX_LOG_SIZE);
  }
  return combined;
};

const pipelineWorker = new Worker<PipelineJobPayload>(
  'pipelineQueue',
  async (job: BullJob<PipelineJobPayload>) => {
    const { userId, promptId, jobId, settings } = job.data;
    console.log(`Processing job ${jobId} for user ${userId}`);

    // Update job status in DB
    const dbJob = await JobModel.findById(jobId);
    if (!dbJob) {
      throw new Error(`Job document ${jobId} not found in MongoDB`);
    }

    dbJob.status = 'running';
    dbJob.logs = appendLogSafe(dbJob.logs, 'Starting pipeline execution...\n');
    await dbJob.save();

    try {
      // 1. Fetch Prompt to get gemini_prompt
      const prompt = await Prompt.findById(promptId);
      if (!prompt) {
        throw new Error(`Prompt ${promptId} not found`);
      }
      const geminiPrompt = prompt.gemini_prompt;

      // 2. Get valid YouTube token
      const youtubeToken = await getValidYouTubeToken(userId);
      if (!youtubeToken) {
        throw new Error('Failed to obtain a valid YouTube token');
      }

      // 3. Resolve path to Python script
      const pythonScriptPath = path.resolve(__dirname, '../../../');

      const args = [
        '-m',
        'youtube_ai_automation.main',
        `--userId=${userId}`,
        `--prompt=${geminiPrompt}`,
        `--token=${youtubeToken}`,
        `--settings=${JSON.stringify(settings)}`,
      ];

      console.log(`Spawning python process in ${pythonScriptPath}`);

      // 4. Wrap execution in a Promise so the worker waits for it to finish
      await new Promise<void>((resolve, reject) => {
        const pythonProcess = spawn('python3', args, {
          cwd: pythonScriptPath,
          env: { ...process.env, PYTHONPATH: 'src' },
        });

        let currentLogs = dbJob.logs;
        let combinedStdoutStderr = ''; // To check for markers later

        pythonProcess.stdout.on('data', (data) => {
          const text = data.toString();
          combinedStdoutStderr += text;
          currentLogs = appendLogSafe(currentLogs, text);
          console.log(`[Pipeline ${jobId} STDOUT]: ${text.trim()}`);

          JobModel.findByIdAndUpdate(jobId, { logs: currentLogs }).exec().catch(console.error);
        });

        pythonProcess.stderr.on('data', (data) => {
          const text = data.toString();
          combinedStdoutStderr += text;
          currentLogs = appendLogSafe(currentLogs, text);
          console.error(`[Pipeline ${jobId} STDERR]: ${text.trim()}`);

          JobModel.findByIdAndUpdate(jobId, { logs: currentLogs }).exec().catch(console.error);
        });

        pythonProcess.on('close', async (code) => {
          // Marker Evaluation Priority: YOUTUBE_REJECTED > SUCCESS > FAILED
          const hasRejected = combinedStdoutStderr.includes('PIPELINE_STATUS:YOUTUBE_REJECTED');
          const hasSuccess = combinedStdoutStderr.includes('PIPELINE_STATUS:SUCCESS');
          // hasFailed is implicit if neither is found, or explicit marker FAILED is present

          if (hasRejected || hasSuccess) {
              await incrementUploadCount(userId).catch(console.error);
          }

          const user = await User.findById(userId);

          if (code === 0) {
            currentLogs = appendLogSafe(currentLogs, `\nProcess exited successfully.`);
            await JobModel.findByIdAndUpdate(jobId, { status: 'success', logs: currentLogs }).catch(console.error);

            if (user) {
              await notifyUser(user, 'Video Upload Successful', '✅ Your video has been uploaded successfully.');
            }
            resolve();
          } else {
            currentLogs = appendLogSafe(currentLogs, `\nProcess failed with code ${code}.`);
            await JobModel.findByIdAndUpdate(jobId, { status: 'failed', logs: currentLogs }).catch(console.error);

            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video upload failed. Please try again.');
            }
            reject(new Error(`Process failed with code ${code}`));
          }
        });

        pythonProcess.on('error', async (err) => {
          currentLogs = appendLogSafe(currentLogs, `\nProcess failed to spawn: ${err.message}`);
          await JobModel.findByIdAndUpdate(jobId, { status: 'failed', logs: currentLogs }).catch(console.error);
          reject(err);
        });
      });

    } catch (error: any) {
      console.error(`Error processing job ${jobId}:`, error);

      // Attempt to record failure in DB if not already captured
      const errorMsg = `\nWorker Error: ${error.message}`;
      const updatedJob = await JobModel.findById(jobId);
      if (updatedJob) {
          const finalLogs = appendLogSafe(updatedJob.logs, errorMsg);
          await JobModel.findByIdAndUpdate(jobId, {
            status: 'failed',
            logs: finalLogs,
          }).catch(console.error);
      }

      throw error;
    }
  },
  {
    connection: connection as any, // Cast to any to bypass strict type matching
    concurrency: 1, // Limit concurrency to 1 jobs at a time
  }
);

pipelineWorker.on('completed', (job) => {
  console.log(`Job ${job.id} has completed successfully`);
});

pipelineWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} has failed with ${err.message}`);
});

// Graceful Shutdown
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, closing worker gracefully...`);
  await pipelineWorker.close();
  await connection.quit();
  await mongoose.connection.close();
  console.log('Worker closed. Exiting process.');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default pipelineWorker;
