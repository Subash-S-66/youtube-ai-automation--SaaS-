import { Worker, Job as BullJob } from 'bullmq';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import { pipelineQueue } from '../queues/pipelineQueue';
import { connection } from '../config/redis';
import JobModel from '../models/Job';
import User from '../models/User';
import Prompt from '../models/Prompt';
import StoryProgress from '../models/StoryProgress';
import { getValidYouTubeToken } from '../services/youtubeTokenService';
import { encrypt } from '../utils/encryption';
import { triggerAzureJob } from './azureJobTrigger';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}
import { PipelineJobPayload } from '../queues/pipelineQueue';
import { consumeReservedCredits, releaseReservedCredits } from '../services/uploadLimitService';
import { notifyUser } from '../services/notificationService';

// Load env vars
dotenv.config();

// Connect to MongoDB BEFORE starting worker
connectDB();

console.log('Worker is starting and connected to Redis/MongoDB...');

const MAX_LOG_SIZE = 100 * 1024; // Limit log to 100 KB

// Helper to batch log updates
const logBuffer: Record<string, { text: string; status?: string; timeout: NodeJS.Timeout | null }> = {};

const flushLogs = async (jobId: string) => {
  const buffer = logBuffer[jobId];
  if (!buffer || !buffer.text) return;

  const { text, status } = buffer;
  // Clear buffer
  buffer.text = '';
  if (buffer.timeout) clearTimeout(buffer.timeout);
  buffer.timeout = null;

  try {
    const dbJob = await JobModel.findById(jobId);
    if (!dbJob) return;

    let combined = (dbJob.logs || '') + text;
    if (combined.length > MAX_LOG_SIZE) {
      combined = '...[LOGS TRUNCATED]...\n' + combined.substring(combined.length - MAX_LOG_SIZE);
    }

    const updateData: any = { logs: combined };
    if (status) updateData.status = status;

    await JobModel.findByIdAndUpdate(jobId, updateData);
  } catch (error) {
    console.error(`Failed to flush logs for job ${jobId}`, error);
  }
};

const appendLogSafe = async (jobId: string, newText: string, status?: string): Promise<void> => {
  if (!logBuffer[jobId]) {
    logBuffer[jobId] = { text: '', timeout: null };
  }

  logBuffer[jobId].text += newText;
  if (status) {
    logBuffer[jobId].status = status;
  }

  // If status is provided (e.g. success/failed/running state change), force flush immediately
  if (status) {
    await flushLogs(jobId);
    return;
  }

  // Otherwise throttle writes to DB (e.g., every 3 seconds)
  if (!logBuffer[jobId].timeout) {
    logBuffer[jobId].timeout = setTimeout(() => {
      flushLogs(jobId);
    }, 3000);
  }
};

const pipelineWorker = new Worker<PipelineJobPayload>(
  'pipelineQueue',
  async (job: BullJob<PipelineJobPayload>) => {
    const { userId, promptId, jobId, settings } = job.data;
    console.log(`Processing job ${jobId} for user ${userId}`);

    let isSkipped = false;

    await JobModel.findByIdAndUpdate(jobId, { status: 'processing', startedAt: new Date() });
    await appendLogSafe(jobId, 'Job is processing...\n');

    try {
      // 1. Check Rolling Limit
      if (settings.channelId) {
         const recentJobs = await JobModel.find({
            userId,
            channelId: settings.channelId,
            status: 'success'
         }).sort({ createdAt: -1 }).limit(10);

         // We check length against 10 (or whatever max we consider, the instructions state if >= 10 get 10th item).
         // Actually the soft limit is 10 uploads. Since a job can contain multiple videos,
         // we need to sum up to the 10-video limit. But instructions simply said:
         // "If uploads >= 10: get oldest upload (10th item). nextAllowedAt = oldest.createdAt + 24 hours"
         if (recentJobs.length >= 10) {
            const oldest = recentJobs[9];
            if (oldest) {
               const nextAllowedAt = new Date(oldest.createdAt.getTime() + 24 * 60 * 60 * 1000);

               const dbJob = await JobModel.findById(jobId);
               const jobScheduledAt = dbJob?.createdAt || new Date();

               if (jobScheduledAt.getTime() < nextAllowedAt.getTime()) {
                  isSkipped = true;
                  await appendLogSafe(jobId, `\nJob skipped due to YouTube 24-hour upload limit. Will not execute pipeline.\n`, 'skipped_due_to_limit');
                  // Update job status manually to ensure the finally block knows it's a completed state
                  await JobModel.findByIdAndUpdate(jobId, { status: 'skipped_due_to_limit' });

                  // Notify user only once per limit window
                  const u = await User.findById(userId);
                  if (u) {
                     const ch = u.youtubeChannels.find(c => c.channelId === settings.channelId);
                     if (ch) {
                        const lastWarning = ch.lastLimitWarningSentAt;
                        if (!lastWarning || lastWarning.getTime() < oldest.createdAt.getTime()) {
                           await User.findOneAndUpdate(
                              { _id: userId, 'youtubeChannels.channelId': settings.channelId },
                              { $set: { 'youtubeChannels.$.lastLimitWarningSentAt': new Date() } }
                           );
                           await notifyUser(u, 'Scheduled Videos Skipped', '⚠️ Some scheduled videos were skipped due to YouTube 24-hour upload limit. Uploads will continue automatically.').catch(console.error);
                        }
                     }
                  }
                  return; // Do not consume upload, release hold in finally block
               }
            }
         }
      }

      // 2. Fetch Prompt to get gemini_prompt
      const prompt = await Prompt.findById(promptId);
      if (!prompt) {
        throw new Error(`Prompt ${promptId} not found`);
      }
      const geminiPrompt = prompt.gemini_prompt;

      // 2b. Safely compute Story Mode state exactly before passing to container
      if (settings.storyMode && settings.storyId) {
        const progress = await StoryProgress.findOne({ userId, storyId: settings.storyId });
        if (progress) {
          settings.currentPart = progress.currentPart;
          settings.lastPrompt = progress.lastPrompt;
        } else {
          settings.currentPart = 1;
          settings.lastPrompt = "";
        }

        // Ensure recap is strictly disabled for Part 1 regardless of frontend payload
        if (settings.currentPart <= 1) {
            settings.recapEnabled = false;
        }

        await appendLogSafe(jobId, `
Proceeding with Story ${settings.storyId} - Episode ${settings.currentPart}...
`, 'running');
      }

      // 3. Get valid YouTube token
      const youtubeToken = await getValidYouTubeToken(userId, settings.channelId);
      if (!youtubeToken) {
        throw new Error('Failed to obtain a valid YouTube token');
      }

      // 4. Trigger Azure Container App Job instead of local spawn
      const AZURE_JOB_NAME = process.env.AZURE_JOB_NAME;
      const AZURE_RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP;
      const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;

      if (!AZURE_JOB_NAME || !AZURE_RESOURCE_GROUP || !AZURE_SUBSCRIPTION_ID) {
         throw new Error("Azure Container App Job configuration is missing.");
      }

      console.log(`Triggering Azure Container App Job: ${AZURE_JOB_NAME}`);

      await JobModel.findByIdAndUpdate(jobId, { status: 'running' });
      await appendLogSafe(jobId, 'Job is running in pipeline...\n');

      // We do NOT pass YOUTUBE_TOKEN as a plain environment variable in the clear.
      // Instead, we pass it encrypted so that it doesn't leak into Azure/Docker logs.
      // We will encrypt the token using the same ENCRYPTION_KEY used for DB storage.
      const encryptedYoutubeToken = encrypt(youtubeToken);

      // Setup payload configuring environment variables for the container run
      const envVars = [
        { name: "USER_ID", value: userId },
        { name: "PROMPT", value: geminiPrompt },
        { name: "SETTINGS", value: JSON.stringify(settings) },
        { name: "YOUTUBE_TOKEN_ENCRYPTED", value: encryptedYoutubeToken },
        { name: "ENCRYPTION_KEY", value: process.env.ENCRYPTION_KEY || "" },
        { name: "JOB_ID", value: jobId },
        { name: "JULES_API_URL", value: process.env.JULES_API_URL || "" },
        { name: "JULES_API_KEY", value: process.env.JULES_API_KEY || "" },
        { name: "MONGO_URI", value: process.env.MONGO_URI || "" }
      ];

      const { success: triggerSuccess, accessToken } = await triggerAzureJob(AZURE_JOB_NAME, envVars);

      if (triggerSuccess) {
         await appendLogSafe(jobId, `\nSuccessfully dispatched Azure Container App Job: ${AZURE_JOB_NAME}\n`);

         const user = await User.findById(userId);

         // Poll Azure Container Apps execution status
         const pollIntervalMs = 10000;
         const pollStart = Date.now();
         const jobTimeoutMs = 15 * 60 * 1000; // 15 mins
         let finalStatusMarker = 'FAILED';

         // Get ARM token for polling
         const armTokenUrl = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
         const armTokenParams = new URLSearchParams({
           grant_type: 'client_credentials',
           client_id: process.env.AZURE_CLIENT_ID || '',
           client_secret: process.env.AZURE_CLIENT_SECRET || '',
           scope: 'https://management.azure.com/.default',
         });

         let armAccessToken = '';
         try {
           const tokenRes = await fetch(armTokenUrl, {
             method: 'POST',
             headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
             body: armTokenParams.toString(),
           });
           const tokenData = await tokenRes.json() as { access_token?: string };
           armAccessToken = tokenData.access_token || '';
         } catch (tokenErr) {
           console.error(`Failed to acquire ARM token for polling job ${jobId}:`, tokenErr);
         }

         if (armAccessToken) {
           const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;
           const AZURE_RESOURCE_GROUP = process.env.RESOURCE_GROUP;
           const executionsUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.App/jobs/${AZURE_JOB_NAME}/executions?api-version=2023-05-01`;

           while (Date.now() - pollStart < jobTimeoutMs) {
             await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

             try {
               const execRes = await fetch(executionsUrl, {
                 headers: { Authorization: `Bearer ${armAccessToken}` },
               });

               if (!execRes.ok) {
                 console.warn(`ARM polling HTTP ${execRes.status} for job ${jobId}`);
                 continue;
               }

               const execData = await execRes.json() as {
                 value?: Array<{ properties?: { status?: string; startTime?: string } }>
               };

               const executions = execData.value || [];
               if (executions.length === 0) continue;

               // Sort by startTime descending, take latest
               const sorted = executions.sort((a, b) => {
                 const timeA = a.properties?.startTime || '';
                 const timeB = b.properties?.startTime || '';
                 return timeB.localeCompare(timeA);
               });

               const latestStatus = sorted[0]?.properties?.status || '';
               await appendLogSafe(jobId, `\n[Azure] Execution status: ${latestStatus}`);

               if (latestStatus === 'Succeeded') {
                 finalStatusMarker = 'SUCCESS';
                 break;
               } else if (
                 latestStatus === 'Failed' ||
                 latestStatus === 'Stopped' ||
                 latestStatus === 'Degraded'
               ) {
                 finalStatusMarker = 'FAILED';
                 break;
               }
               // Running/Pending/Scheduled — keep polling
             } catch (pollErr) {
               console.warn(`ARM polling error for job ${jobId}:`, pollErr);
             }
           }

           if (Date.now() - pollStart >= jobTimeoutMs) {
             await appendLogSafe(jobId, `\n[Azure] Job timed out after ${jobTimeoutMs}ms`);
             finalStatusMarker = 'FAILED';
           }
         } else {
           // No ARM token available — fall back to webhook-driven status
           await appendLogSafe(jobId, `\n[Azure] No ARM token — relying on webhook for status updates.`);
           finalStatusMarker = 'FAILED'; // Default pessimistic until webhook updates
         }

         // Fetch the latest logs to evaluate specific backend markers
         // since Python webhook may have updated them asynchronously
         const finalDbJob = await JobModel.findById(jobId);
         const finalLogs = finalDbJob?.logs || '';

         if (
             finalLogs.includes('PIPELINE_STATUS:YOUTUBE_REJECTED') ||
             finalLogs.includes('uploadLimitExceeded') ||
             finalLogs.includes('quotaExceeded') ||
             finalLogs.includes('dailyLimitExceeded')
         ) {
             finalStatusMarker = 'YOUTUBE_REJECTED';
         } else if (finalLogs.includes('PIPELINE_STATUS:SUCCESS')) {
             finalStatusMarker = 'SUCCESS';
         } else if (finalLogs.includes('PIPELINE_STATUS:FAILED')) {
             finalStatusMarker = 'FAILED';
         }

         // The webhook handles consumption now, but as a fallback, we check here too.
         // Let's rely entirely on the Webhook to mark holdReleased/holdConsumed for SUCCESS/FAILED.
         // However, if the job timed out and webhook never fired, we handle it here.

         const currentJobState = await JobModel.findById(jobId);
         if (!currentJobState || currentJobState.holdConsumed || currentJobState.holdReleased) {
            console.log(`Job ${jobId} already processed holds. Skipping double release/consume.`);
            return; // Already handled by Webhook or previous timeout
         }

         if (finalStatusMarker === 'SUCCESS') {
            await JobModel.findByIdAndUpdate(jobId, {
                status: 'completed',
                completedAt: new Date(),
                holdConsumed: true
            });
            await consumeReservedCredits(userId, settings.videoCount || 1).catch(console.error);

            // Handle Story Mode increment
            if (settings.storyMode && settings.storyId) {
                try {
                   const nextPart = (settings.currentPart || 1) + 1;
                   await StoryProgress.findOneAndUpdate(
                       { userId, storyId: settings.storyId },
                       {
                           $set: {
                               lastPrompt: geminiPrompt,
                               currentPart: nextPart
                           }
                       },
                       { upsert: true, returnDocument: 'after' }
                   );
                   console.log(`Story ${settings.storyId} progressed to part ${nextPart} for user ${userId}`);
                } catch (err) {
                   console.error('Failed to update StoryProgress', err);
                }
            }

            if (user) {
              await notifyUser(user, 'Video Upload Successful', '✅ Your video has been uploaded successfully.').catch(console.error);
            }
         } else if (finalStatusMarker === 'YOUTUBE_REJECTED') {
            const dbJobCheck = await JobModel.findById(jobId);
            const acceptedWarning = dbJobCheck?.acceptedYouTubeLimitWarning || false;

            if (acceptedWarning) {
              // Treated as consumed because user explicitly accepted the risk
              await JobModel.findByIdAndUpdate(jobId, {
                  status: 'failed',
                  completedAt: new Date(),
                  holdConsumed: true,
                  error: 'YouTube Quota Exceeded (Warning Accepted)'
              });
              await consumeReservedCredits(userId, settings.videoCount || 1).catch(console.error);
            } else {
              await JobModel.findByIdAndUpdate(jobId, {
                  status: 'failed',
                  completedAt: new Date(),
                  holdReleased: true,
                  error: 'YouTube Quota Exceeded'
              });
              await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);
            }

            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video upload failed due to YouTube limits.').catch(console.error);
            }
         } else {
            await JobModel.findByIdAndUpdate(jobId, {
                status: 'failed',
                completedAt: new Date(),
                holdReleased: true,
                error: 'Generation or upload failed'
            });
            await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);

            // FAILED (normal) - do not increment usage
            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video generation or upload failed. Please try again.').catch(console.error);
            }
         }

      } else {
         throw new Error("Failed to trigger Azure Container App Job via REST API");
      }

    } catch (error: any) {
      console.error(`Error processing job ${jobId}:`, error);

      if (process.env.SENTRY_DSN) {
        Sentry.captureException(error, { extra: { jobId, userId } });
      }

      const errorMsg = `\nWorker Error: ${error.message}`;
      await appendLogSafe(jobId, errorMsg);

      const dbJob = await JobModel.findById(jobId);
      if (dbJob && !dbJob.holdConsumed && !dbJob.holdReleased) {
         // Gracefully handle failure and credit release
         await JobModel.findByIdAndUpdate(jobId, {
             status: 'failed',
             completedAt: new Date(),
             holdReleased: true,
             error: error.message
         });
         await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);
      }

      throw error;
    } finally {
      // Decrease the channel specific hold unconditionally if the job finished/failed/was skipped
      // The `releaseReservedCredits` covers global. Channel holds are just local guards.
      const dbJob = await JobModel.findById(jobId);
      if (dbJob && dbJob.status !== 'running' && dbJob.status !== 'processing' && dbJob.status !== 'queued') {
        const decrementCount = settings.videoCount || 1;
        await User.updateOne(
          { _id: userId, 'youtubeChannels.channelId': settings.channelId, 'youtubeChannels.videosOnHold': { $gte: decrementCount } },
          { $inc: { 'youtubeChannels.$.videosOnHold': -decrementCount } }
        ).catch((err) => console.error(`Failed to decrement channel holds for user ${userId}:`, err));
      }
    }
  },
  {
    connection: connection as any, // Cast to any to bypass strict type matching
    concurrency: 5, // Limit concurrency to 5 jobs at a time to improve performance
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
  if (connection) {
    await connection.quit();
  }
  await mongoose.connection.close();
  console.log('Worker closed. Exiting process.');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default pipelineWorker;
