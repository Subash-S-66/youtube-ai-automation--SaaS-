import { Worker, Job as BullJob } from 'bullmq';
import { spawn } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import connectDB from '../config/db';
import { connection } from '../config/redis';
import JobModel from '../models/Job';
import Prompt from '../models/Prompt';
import { getValidYouTubeToken } from '../services/youtubeTokenService';
import { PipelineJobPayload } from '../queues/pipelineQueue';

// Load env vars
dotenv.config();

// Connect to MongoDB
connectDB();

console.log('Worker is starting and connecting to Redis/MongoDB...');

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
    dbJob.logs += 'Starting pipeline execution...\n';
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

        pythonProcess.stdout.on('data', (data) => {
          const text = data.toString();
          currentLogs += text;
          console.log(`[Pipeline ${jobId} STDOUT]: ${text.trim()}`);

          JobModel.findByIdAndUpdate(jobId, { logs: currentLogs }).exec().catch(console.error);
        });

        pythonProcess.stderr.on('data', (data) => {
          const text = data.toString();
          currentLogs += text;
          console.error(`[Pipeline ${jobId} STDERR]: ${text.trim()}`);

          JobModel.findByIdAndUpdate(jobId, { logs: currentLogs }).exec().catch(console.error);
        });

        pythonProcess.on('close', async (code) => {
          if (code === 0) {
            currentLogs += `\nProcess exited successfully.`;
            await JobModel.findByIdAndUpdate(jobId, { status: 'success', logs: currentLogs }).catch(console.error);
            resolve();
          } else {
            currentLogs += `\nProcess failed with code ${code}.`;
            await JobModel.findByIdAndUpdate(jobId, { status: 'failed', logs: currentLogs }).catch(console.error);
            reject(new Error(`Process failed with code ${code}`));
          }
        });

        pythonProcess.on('error', async (err) => {
          currentLogs += `\nProcess failed to spawn: ${err.message}`;
          await JobModel.findByIdAndUpdate(jobId, { status: 'failed', logs: currentLogs }).catch(console.error);
          reject(err);
        });
      });

    } catch (error: any) {
      console.error(`Error processing job ${jobId}:`, error);

      // Attempt to record failure in DB if not already captured
      await JobModel.findByIdAndUpdate(jobId, {
        status: 'failed',
        $set: { logs: dbJob.logs + `\nWorker Error: ${error.message}` },
      }).catch(console.error);

      throw error;
    }
  },
  {
    connection: connection as any, // Cast to any to bypass strict type matching
    concurrency: 2, // Limit concurrency to 2 jobs at a time
  }
);

pipelineWorker.on('completed', (job) => {
  console.log(`Job ${job.id} has completed successfully`);
});

pipelineWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} has failed with ${err.message}`);
});

export default pipelineWorker;
