import dotenv from 'dotenv';
dotenv.config();
import { Worker, Job as BullJob, UnrecoverableError } from 'bullmq';
import { acquireLock, releaseLock } from '../utils/redisLock';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import { pipelineQueue } from '../queues/pipelineQueue';
import { connection } from '../config/redis';
import JobModel from '../models/Job';
import Prompt from '../models/Prompt';
import User from '../models/User';
import StoryProgress from '../models/StoryProgress';
import SystemConfig from '../models/SystemConfig';
import Media from '../models/Media';
import { ensureValidYouTubeToken } from '../services/youtubeTokenService';
import { generateContent } from '../services/contentGenerationService';
import { encrypt } from '../utils/encryption';
import { triggerAzureJob } from './azureJobTrigger';
import { triggerLocalPipeline } from './localPipelineTrigger';
import { triggerRemotePipeline } from './remotePipelineTrigger';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { normalizePipelineSettings } from '../services/pipelineRunService';

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

const hasYoutubeOAuthConfig = Boolean(
  (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
  (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET) &&
  (process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI)
);
if (!hasYoutubeOAuthConfig) {
  console.warn(
    '[PipelineWorker] Missing YouTube OAuth env vars. Upload jobs will fail at TOKEN stage. Configure YOUTUBE_* or GOOGLE_* vars.'
  );
}

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

const resolvePipelineRunner = async (): Promise<'local' | 'azure' | 'remote'> => {
  const envRunner = (process.env.PIPELINE_RUNNER || '').toLowerCase();
  if (envRunner === 'local' || envRunner === 'azure' || envRunner === 'remote') {
    return envRunner;
  }
  try {
    const config = await SystemConfig.findOne().sort({ updatedAt: -1 });
    if (config?.pipelineRunner === 'azure' || config?.pipelineRunner === 'local') {
      return config.pipelineRunner;
    }
  } catch (error) {
    console.warn('Failed to load SystemConfig for pipeline runner. Falling back to env.', error);
  }
  return process.env.PIPELINE_SERVICE_URL ? 'remote' : 'local';
};

const updateProgressSafe = async (
  job: BullJob<PipelineJobPayload>,
  progress: number,
  stage: string,
  message?: string
): Promise<void> => {
  try {
    await job.updateProgress({
      progress: Math.max(0, Math.min(100, Math.floor(progress))),
      stage,
      message: message || '',
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Best-effort only
  }
};

const shouldRequireYouTubeUpload = (settings: Record<string, any>, uploadTargetId?: string): boolean => {
  if (!settings || typeof settings !== 'object') return false;
  if (settings.upload === false) return false;
  return Boolean(
    settings.upload === true ||
    settings.autoUpload === true ||
    settings.autoUploadSchedule === true ||
    settings.scheduleEnabled === true ||
    settings.publishNow === true ||
    // Immediate dashboard runs usually provide a channelId without explicit upload flags.
    (typeof settings.channelId === 'string' && settings.channelId.trim().length > 0) ||
    (typeof uploadTargetId === 'string' && uploadTargetId.trim().length > 0)
  );
};

const resolveYouTubeUploadTarget = (
  settings: Record<string, any>,
  executionJob: Record<string, any>
): string => {
  const candidates = [
    settings?.youtubeAccountId,
    settings?.channelId,
    settings?.accountId,
    executionJob?.youtubeAccountId,
    executionJob?.channelId,
  ];
  for (const raw of candidates) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value) return value;
  }
  return '';
};

const extractPipelineOutputJson = (stdout: string): Record<string, any> | null => {
  const marker = 'PIPELINE_OUTPUT_JSON:';
  const index = stdout.lastIndexOf(marker);
  if (index === -1) return null;
  const tail = stdout.slice(index + marker.length);
  if (!tail.trim()) return null;

  // Robust extraction: parse first balanced JSON object after marker
  // (stdout may contain extra lines after the JSON payload).
  const start = tail.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < tail.length; i++) {
    const ch = tail[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = tail.slice(start, i + 1).trim();
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

const parseBaseUrl = (value: string): string => {
  const cleaned = value.trim();
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return cleaned.replace(/\/+$/, '');
  }
};

const resolveBackendBaseUrl = (): string => {
  const explicit = process.env.BACKEND_URL || '';
  if (explicit.trim()) {
    return parseBaseUrl(explicit);
  }
  const webhookUrl = process.env.WEBHOOK_URL || '';
  if (webhookUrl.trim()) {
    return parseBaseUrl(webhookUrl);
  }
  return '';
};

const uniqueStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const sanitizePayloadValue = (value: any): any => {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizePayloadValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      const sanitized = sanitizePayloadValue(entry);
      if (sanitized !== undefined) {
        out[key] = sanitized;
      }
    }
    return out;
  }
  if (value === undefined || value === null) return undefined;
  return value;
};

const buildMediaFileUrl = (baseUrl: string, filename: string): string => {
  return `${baseUrl}/api/media/file/${encodeURIComponent(filename)}`;
};

const resolveMediaUrlsByIds = async (
  params: {
    userId: string;
    ids: unknown;
    expectedType: 'video' | 'image' | 'thumbnail';
    baseUrl: string;
  }
): Promise<{ urls: string[]; requested: number; resolved: number; invalidIds: number; missing: number }> => {
  const requestedIds = uniqueStringArray(params.ids);
  if (requestedIds.length === 0 || !params.baseUrl) {
    return { urls: [], requested: requestedIds.length, resolved: 0, invalidIds: 0, missing: requestedIds.length };
  }

  const validIds = requestedIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const invalidIds = requestedIds.length - validIds.length;
  if (validIds.length === 0) {
    return {
      urls: [],
      requested: requestedIds.length,
      resolved: 0,
      invalidIds,
      missing: requestedIds.length,
    };
  }

  const mediaDocs = await Media.find({
    _id: { $in: validIds },
    userId: params.userId,
    type: params.expectedType,
  }).select('_id filename');

  const byId = new Map<string, string>();
  for (const doc of mediaDocs) {
    const docId = String(doc._id);
    if (doc.filename) {
      byId.set(docId, buildMediaFileUrl(params.baseUrl, doc.filename));
    }
  }

  const urls = validIds.map((id) => byId.get(id)).filter((url): url is string => Boolean(url));
  const missing = Math.max(0, requestedIds.length - urls.length);
  return {
    urls,
    requested: requestedIds.length,
    resolved: urls.length,
    invalidIds,
    missing,
  };
};

const pipelineWorker = new Worker<PipelineJobPayload>(
  'pipelineQueue',
  async (job: BullJob<PipelineJobPayload>) => {
    const { userId, jobId, settings: rawSettings } = job.data;
    if (job.attemptsMade > 1) {
      console.warn(`[PipelineWorker] Retry detected for job: ${job.id} (attemptsMade=${job.attemptsMade})`);
    }
    const inputAudit = normalizePipelineSettings(rawSettings || {});
    let settings = inputAudit.normalizedSettings;
    console.log(`Processing job ${jobId} for user ${userId}`);

    let isSkipped = false;

    const res = await JobModel.updateOne(
      { _id: jobId, status: 'pending' },
      {
        $set: {
          status: 'processing',
          startedAt: new Date(),
          executionLockedAt: new Date(),
        }
      }
    );
    if (res.modifiedCount === 0) {
      return;
    }
    const lockedJob = await JobModel.findById(jobId);
    if (!lockedJob) return;

    if (lockedJob.pipelineConfig) {
      const persistedAudit = normalizePipelineSettings(lockedJob.pipelineConfig as Record<string, any>);
      settings = persistedAudit.normalizedSettings;
    }

    await appendLogSafe(jobId, 'Job is processing...\n');
    await updateProgressSafe(job, 5, 'processing', 'Job accepted by worker');
    if (inputAudit.aliasMappings.length) {
      await appendLogSafe(jobId, `Input alias mappings applied: ${inputAudit.aliasMappings.join(', ')}\n`);
    }
    if (inputAudit.unusedFields.length) {
      await appendLogSafe(jobId, `Input fields currently not used by runtime: ${inputAudit.unusedFields.join(', ')}\n`);
    }
    if (inputAudit.notes.length) {
      await appendLogSafe(jobId, `Input notes: ${inputAudit.notes.join(' | ')}\n`);
    }

    const lockKey = `lock:job:${jobId}`;
    const acquired = await acquireLock(lockKey, 3600); // 1 hour TTL
    if (!acquired) {
      console.warn(`[PipelineWorker] Job ${jobId} is currently being processed by another worker. Throwing error to trigger BullMQ retry.`);
      throw new Error(`Job ${jobId} is locked by another instance.`);
    }
    console.log(`[PipelineWorker] Acquired lock for Job ${jobId} (User: ${userId})`);

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
                  await appendLogSafe(jobId, `\nJob rejected due to YouTube 24-hour upload limit.\n`, 'failed');
                  await JobModel.findByIdAndUpdate(jobId, { status: 'failed', errorMessage: 'Skipped due to YouTube 24-hour upload limit', errorStage: 'UPLOAD' });

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

      // 2. Load backend-prepared content from DB (execution-only pipeline)
      await updateProgressSafe(job, 12, 'content_load', 'Loading prepared content');
      const dbJobForExecution = await JobModel.findById(jobId);
      if (!dbJobForExecution) {
        throw new Error(`Job ${jobId} not found`);
      }
      if (dbJobForExecution.youtubeVideoId) {
        await appendLogSafe(jobId, 'Job already has youtubeVideoId. Skipping duplicate execution.\n', 'success');
        await JobModel.findByIdAndUpdate(jobId, {
          status: 'success',
          completedAt: new Date(),
          errorMessage: '',
          errorStage: undefined as any,
        });
        return;
      }
      let preparedContent = Array.isArray(dbJobForExecution.preparedContent) ? dbJobForExecution.preparedContent : [];
      if (preparedContent.length === 0) {
        await appendLogSafe(jobId, 'No prepared content found. Generating content in background worker...\n');
        await updateProgressSafe(job, 22, 'content_generation', 'Generating structured content');

        const promptDoc = await Prompt.findById(dbJobForExecution.promptId);
        if (!promptDoc) {
          const err: any = new Error('Prompt not found for background content generation.');
          err.stage = 'CONTENT_GENERATION';
          throw err;
        }

        const generationInput: any = {
          topic: promptDoc.user_prompt,
          prompt: promptDoc.gemini_prompt || promptDoc.user_prompt,
          videoCount: settings.videoCount || 1,
        };
        if (typeof settings.targetDuration === 'number') generationInput.targetDuration = settings.targetDuration;
        if (typeof settings.duration === 'number') generationInput.duration = settings.duration;
        if (typeof settings.storyMode === 'boolean') generationInput.storyMode = settings.storyMode;
        if (typeof settings.currentPart === 'number') generationInput.currentPart = settings.currentPart;
        if (typeof settings.recapEnabled === 'boolean') generationInput.recapEnabled = settings.recapEnabled;
        if (typeof settings.ctaEnabled === 'boolean') generationInput.ctaEnabled = settings.ctaEnabled;
        if (typeof settings.lastPrompt === 'string') generationInput.lastPrompt = settings.lastPrompt;
        if (settings.templateConfig && typeof settings.templateConfig === 'object') {
          generationInput.templateConfig = settings.templateConfig;
        }

        const generated = await generateContent(generationInput);
        console.log(`[PipelineWorker] Model used for content generation:`, generationInput);
        await appendLogSafe(jobId, `[PipelineWorker] Model used for content generation: ${JSON.stringify(generationInput)}\n`);
        console.log(`[PipelineWorker] Prompt generated:`, generated.prompt);
        await appendLogSafe(jobId, `[PipelineWorker] Prompt generated: ${generated.prompt}\n`);
        console.log(`[PipelineWorker] Generated script:`, generated.script);
        await appendLogSafe(jobId, `[PipelineWorker] Generated script: ${JSON.stringify(generated.script)}\n`);
        if (generated.captions) {
          console.log(`[PipelineWorker] Generated captions:`, generated.captions);
          await appendLogSafe(jobId, `[PipelineWorker] Generated captions: ${JSON.stringify(generated.captions)}\n`);
        }
        if (generated.title) {
          console.log(`[PipelineWorker] Generated title:`, generated.title);
          await appendLogSafe(jobId, `[PipelineWorker] Generated title: ${generated.title}\n`);
        }
        if (generated.description) {
          console.log(`[PipelineWorker] Generated description:`, generated.description);
          await appendLogSafe(jobId, `[PipelineWorker] Generated description: ${generated.description}\n`);
        }
        if (generated.hashtags) {
          console.log(`[PipelineWorker] Generated hashtags:`, generated.hashtags);
          await appendLogSafe(jobId, `[PipelineWorker] Generated hashtags: ${JSON.stringify(generated.hashtags)}\n`);
        }
        if (generated.metadata) {
          console.log(`[PipelineWorker] Generated metadata:`, generated.metadata);
          await appendLogSafe(jobId, `[PipelineWorker] Generated metadata: ${JSON.stringify(generated.metadata)}\n`);
        }
        if (generated.preparedContent) {
          console.log(`[PipelineWorker] Generated preparedContent:`, generated.preparedContent);
          await appendLogSafe(jobId, `[PipelineWorker] Generated preparedContent: ${JSON.stringify(generated.preparedContent)}\n`);
        }
        console.log(`[PipelineWorker] Saving generated content to DB for job ${jobId}`);
        const validStructuredScript = Array.isArray(generated.script)
          && generated.script.every(
            (part) => Array.isArray(part) && part.every((line) => line && typeof line.text === 'string' && line.text.trim().length > 0)
          );
        if (!validStructuredScript) {
          const err: any = new Error('Generated script is invalid in background worker.');
          err.stage = 'CONTENT_GENERATION';
          throw err;
        }

        await JobModel.findByIdAndUpdate(jobId, {
          generatedPrompt: generated.prompt,
          generatedScript: generated.script,
          captions: generated.captions,
          title: generated.title,
          description: generated.description,
          hashtags: generated.hashtags,
          generatedScenes: generated.scenes,
          generatedMetadata: generated.metadata,
          preparedContent: generated.preparedContent,
        });

        preparedContent = generated.preparedContent as any[];
          console.log(`[PipelineWorker] Content generation completed for job ${jobId}. Items: ${preparedContent.length}`);
        await appendLogSafe(jobId, `Background content generation completed with ${preparedContent.length} item(s).\n`);
          await appendLogSafe(jobId, `[PipelineWorker] Content generation completed for job ${jobId}. Items: ${preparedContent.length}\n`);
        await updateProgressSafe(job, 38, 'content_generation', 'Content generation completed');
      }
      const executionJob = (await JobModel.findById(jobId)) || dbJobForExecution;
      const firstPreparedItem = (preparedContent[0] && typeof preparedContent[0] === 'object')
        ? (preparedContent[0] as Record<string, any>)
        : {};
      const generatedScript = Array.isArray(executionJob.generatedScript?.[0])
        ? (executionJob.generatedScript?.[0] || [])
        : (executionJob.generatedScript || []);
      const payloadScript = Array.isArray(generatedScript) && generatedScript.length > 0
        ? generatedScript
        : (Array.isArray(firstPreparedItem.script) ? firstPreparedItem.script : []);
      const payloadCaptions = Array.isArray(executionJob.captions?.[0])
        ? (executionJob.captions?.[0] || [])
        : (Array.isArray(executionJob.captions) ? executionJob.captions : []);
      const fallbackCaptions = Array.isArray(firstPreparedItem.captions) ? firstPreparedItem.captions : [];
      if (!Array.isArray(payloadScript) || payloadScript.length === 0) {
        const err: any = new Error('Prepared script is missing or empty. Cannot dispatch pipeline execution.');
        err.stage = 'CONTENT_GENERATION';
        throw err;
      }
      const generatedPrompt = executionJob.generatedPrompt || '';
      const backendBaseUrl = resolveBackendBaseUrl();
      if (!backendBaseUrl) {
        await appendLogSafe(
          jobId,
          `${JSON.stringify({ event: 'media_resolution', level: 'warn', reason: 'backend_url_missing' })}\n`
        );
      } else if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/i.test(backendBaseUrl)) {
        await appendLogSafe(
          jobId,
          `${JSON.stringify({ event: 'media_resolution', level: 'warn', reason: 'backend_url_localhost_in_production', backendBaseUrl })}\n`
        );
      }

      const resolvedCustomVideos = await resolveMediaUrlsByIds({
        userId,
        ids: executionJob.customVideoIds || settings.customVideoIds || [],
        expectedType: 'video',
        baseUrl: backendBaseUrl,
      });
      const resolvedCustomImages = await resolveMediaUrlsByIds({
        userId,
        ids: executionJob.customImageIds || settings.customImageIds || [],
        expectedType: 'image',
        baseUrl: backendBaseUrl,
      });
      const resolvedCustomThumbnail = await resolveMediaUrlsByIds({
        userId,
        ids: executionJob.customThumbnailId ? [executionJob.customThumbnailId] : (settings.customThumbnailId ? [settings.customThumbnailId] : []),
        expectedType: 'thumbnail',
        baseUrl: backendBaseUrl,
      });

      await appendLogSafe(
        jobId,
        `${JSON.stringify({
          event: 'media_resolution',
          customVideos: {
            requested: resolvedCustomVideos.requested,
            resolved: resolvedCustomVideos.resolved,
            invalidIds: resolvedCustomVideos.invalidIds,
            missing: resolvedCustomVideos.missing,
          },
          customImages: {
            requested: resolvedCustomImages.requested,
            resolved: resolvedCustomImages.resolved,
            invalidIds: resolvedCustomImages.invalidIds,
            missing: resolvedCustomImages.missing,
          },
          customThumbnail: {
            requested: resolvedCustomThumbnail.requested,
            resolved: resolvedCustomThumbnail.resolved,
            invalidIds: resolvedCustomThumbnail.invalidIds,
            missing: resolvedCustomThumbnail.missing,
          },
        })}\n`
      );
      await updateProgressSafe(job, 50, 'payload_build', 'Media resolution and payload build');

      const payloadVideoConfig = sanitizePayloadValue({
        ...(executionJob.pipelineConfig || settings || {}),
        customVideoUrls: resolvedCustomVideos.urls,
        customImageUrls: resolvedCustomImages.urls,
        customThumbnailUrl: resolvedCustomThumbnail.urls[0] || '',
        templateConfig: {
          fontStyle: settings.templateConfig?.fontStyle || 'Anton',
          subtitleColor: settings.templateConfig?.subtitleColor || '#FFFFFF',
          captionPosition: (settings.templateConfig as any)?.captionPosition || 'bottom',
        },
        targetDuration: settings.targetDuration || settings.duration || 40,
        ctaEnabled: !!settings.ctaEnabled,
        recapEnabled: !!settings.recapEnabled,
        storyMode: !!settings.storyMode,
        currentPart: settings.currentPart || 1,
        voiceName: (settings.voices && settings.voices[0]) || '',
      });

      const uploadTargetChannelId = resolveYouTubeUploadTarget(
        settings as Record<string, any>,
        executionJob as Record<string, any>
      );

      const pipelinePayload = sanitizePayloadValue({
        jobId,
        mode: String((settings as any)?.mode || (settings as any)?.executionMode || process.env.PIPELINE_DEFAULT_MODE || 'full')
          .trim()
          .toLowerCase() === 'prepared'
          ? 'prepared'
          : 'full',
        topic: String((executionJob as any)?.topic || (firstPreparedItem as any)?.topic || '').trim(),
        script: payloadScript,
        captions: payloadCaptions.length > 0 ? payloadCaptions : fallbackCaptions,
        videoConfig: payloadVideoConfig,
        targetDuration: settings.targetDuration || settings.duration || 40,
        ctaEnabled: !!settings.ctaEnabled,
        recapEnabled: !!settings.recapEnabled,
        youtube: {
          title: executionJob.title || String(firstPreparedItem.title || ''),
          description: executionJob.description || String(firstPreparedItem.description || ''),
          hashtags: Array.isArray(executionJob.hashtags) && executionJob.hashtags.length > 0
            ? executionJob.hashtags
            : (Array.isArray(firstPreparedItem.hashtags) ? firstPreparedItem.hashtags : []),
          accountId: uploadTargetChannelId,
        },
      });
      if (!Array.isArray(pipelinePayload?.script) || pipelinePayload.script.length === 0) {
        const err: any = new Error('pipelinePayload.script is required and must be a non-empty array.');
        err.stage = 'CONTENT_GENERATION';
        throw err;
      }
      if (!pipelinePayload?.youtube || typeof pipelinePayload.youtube !== 'object') {
        const err: any = new Error('pipelinePayload.youtube is required.');
        err.stage = 'CONTENT_GENERATION';
        throw err;
      }
      await appendLogSafe(
        jobId,
        `${JSON.stringify({
          event: 'payload_creation',
          scriptLines: pipelinePayload.script.length,
          captionLines: Array.isArray(pipelinePayload.captions) ? pipelinePayload.captions.length : 0,
          hasCustomVideoUrls: Array.isArray(pipelinePayload.videoConfig?.customVideoUrls) && pipelinePayload.videoConfig.customVideoUrls.length > 0,
          hasCustomImageUrls: Array.isArray(pipelinePayload.videoConfig?.customImageUrls) && pipelinePayload.videoConfig.customImageUrls.length > 0,
          hasCustomThumbnailUrl: Boolean(pipelinePayload.videoConfig?.customThumbnailUrl),
        })}\n`
      );

      // 2b. Safely compute Story Mode state exactly before passing to container
      if (settings.storyMode && settings.storyId) {
        const progress = await StoryProgress.findOne({ userId, storyId: settings.storyId });
        const hasCurrentPartInput = typeof settings.currentPart === 'number' && Number.isFinite(settings.currentPart);
        const hasLastPromptInput = typeof settings.lastPrompt === 'string' && settings.lastPrompt.length > 0;

        if (progress) {
          if (!hasCurrentPartInput) {
            settings.currentPart = progress.currentPart;
          }
          if (!hasLastPromptInput) {
            settings.lastPrompt = progress.lastPrompt;
          }
        } else {
          if (!hasCurrentPartInput) {
            settings.currentPart = 1;
          }
          if (!hasLastPromptInput) {
            settings.lastPrompt = '';
          }
        }

        // Ensure recap is strictly disabled for Part 1 regardless of frontend payload
        if ((settings.currentPart || 1) <= 1) {
            if (settings.recapEnabled) {
              await appendLogSafe(jobId, 'recapEnabled was provided but disabled for story part 1.\n');
            }
            settings.recapEnabled = false;
        }

        await appendLogSafe(jobId, `
Proceeding with Story ${settings.storyId} - Episode ${settings.currentPart}...
`, 'processing');
      }

      // 3. Ensure valid YouTube token only if this run requires upload.
      const requiresUpload = shouldRequireYouTubeUpload(settings as Record<string, any>, uploadTargetChannelId);
      await appendLogSafe(
        jobId,
        `${JSON.stringify({
          event: 'upload_decision',
          requiresUpload,
          uploadTargetChannelId,
          uploadFlag: (settings as any).upload,
          autoUpload: (settings as any).autoUpload,
          publishNow: (settings as any).publishNow,
        })}\n`
      );
      let youtubeToken = '';
      if (requiresUpload) {
        if (!uploadTargetChannelId) {
          const err: any = new Error('Upload requested but no YouTube channel/account id was resolved.');
          err.stage = 'UPLOAD';
          throw err;
        }
        await updateProgressSafe(job, 60, 'token_validation', 'Validating YouTube token');
        try {
          youtubeToken = (await ensureValidYouTubeToken(uploadTargetChannelId, userId)).accessToken;
        } catch (error: any) {
          error.stage = 'TOKEN';
          throw error;
        }
        if (!youtubeToken) {
          const err: any = new Error('Failed to obtain a valid YouTube token');
          err.stage = 'TOKEN';
          throw err;
        }
      } else {
        await appendLogSafe(jobId, 'Upload not requested for this job. Skipping YouTube token validation.\n');
        await updateProgressSafe(job, 60, 'token_validation', 'Upload disabled, token validation skipped');
      }

      // 4. Trigger pipeline runner (GitHub Actions or Azure Container Apps Job)
      const pipelineRunner = await resolvePipelineRunner();
      const dispatchLockKey = `pipeline:dispatch:${jobId}`;
      const dispatchLock = await (connection as any).set(dispatchLockKey, String(Date.now()), 'NX', 'EX', 24 * 60 * 60);
      if (dispatchLock !== 'OK') {
        await appendLogSafe(
          jobId,
          `${JSON.stringify({ event: 'dispatch_skip', reason: 'idempotency_lock_exists', jobId })}\n`,
          'processing'
        );
        return;
      }

      // Ensure startedAt and processing state is explicitly set right before launching pipeline worker
      // Although we atomically lock it above, we refresh it here to act as the official timer start
      await JobModel.findByIdAndUpdate(jobId, { status: 'processing', startedAt: new Date() });
      await appendLogSafe(jobId, 'Job is running in pipeline...\n', 'processing');
      await updateProgressSafe(job, 70, 'dispatch', 'Dispatching pipeline runtime');

      // We do NOT pass YOUTUBE_TOKEN as a plain environment variable in the clear.
      // Instead, we pass it encrypted so that it doesn't leak into Azure/Docker logs.
      // We will encrypt the token using the same ENCRYPTION_KEY used for DB storage.
      const encryptedYoutubeToken = youtubeToken ? encrypt(youtubeToken) : '';

      // Setup payload configuring environment variables for the container run
      // Production hardening: always execute full video generation runtime.
      const runtimeMode = 'full';
      const envVars = [
        { name: "USER_ID", value: userId },
        { name: "PIPELINE_PAYLOAD", value: JSON.stringify(pipelinePayload) },
        { name: "RUN_MODE", value: runtimeMode },
        { name: "YOUTUBE_TOKEN_ENCRYPTED", value: encryptedYoutubeToken },
        { name: "ENCRYPTION_KEY", value: process.env.ENCRYPTION_KEY || "" },
        { name: "UPLOAD", value: requiresUpload ? "true" : "false" },
        { name: "JOB_ID", value: jobId },
        { name: "JULES_API_URL", value: process.env.JULES_API_URL || "" },
        { name: "JULES_API_KEY", value: process.env.JULES_API_KEY || "" },
        { name: "GEMINI_API_KEY", value: process.env.GEMINI_API_KEY || "" },
        { name: "GEMINI_AUDIO_ENABLED", value: "true" },
        { name: "GEMINI_AUDIO_ONLY", value: "true" },
        { name: "FORCE_GOOGLE_AUDIO_ONLY", value: "true" },
        { name: "GEMINI_AUDIO_MODEL", value: process.env.GEMINI_AUDIO_MODEL || "gemini-2.5-flash-native-audio-latest" },
        { name: "ALLOW_SILENT_AUDIO_FALLBACK", value: "false" },
        { name: "WEBHOOK_SECRET", value: process.env.WEBHOOK_SECRET || "" },
        { name: "BACKEND_URL", value: process.env.BACKEND_URL || "" },
      ];

      if (pipelineRunner === 'remote') {
        await appendLogSafe(jobId, `\nDispatching remote pipeline service for job ${jobId}...\n`);
        const remoteResult = await triggerRemotePipeline({
          jobId,
          userId,
          envVars,
        });
        await appendLogSafe(jobId, `\nRemote pipeline accepted: ${remoteResult.message}\n`);
        return;
      }

      if (pipelineRunner === 'local') {
        await appendLogSafe(jobId, `\nDispatching local pipeline process for job ${jobId}...\n`);
        const result = await triggerLocalPipeline(envVars);
        const stdoutTail = (result.stdout || '').slice(-2000);
        const stderrTail = (result.stderr || '').slice(-2000);
        const outputJson = extractPipelineOutputJson(result.stdout || '');
        if (stdoutTail) {
          await appendLogSafe(jobId, `\n[LocalPipeline][stdout-tail]\n${stdoutTail}\n`);
        }
        if (stderrTail) {
          await appendLogSafe(jobId, `\n[LocalPipeline][stderr-tail]\n${stderrTail}\n`);
        }
        if (!result.success) {
          const err: any = new Error(`Local pipeline process failed with exit code ${result.exitCode ?? 'unknown'}`);
          err.stderrTail = stderrTail;
          err.stdoutTail = stdoutTail;
          err.stage = 'RENDER';
          throw err;
        }
        await appendLogSafe(jobId, `\nLocal pipeline process finished.\n`);
        await updateProgressSafe(job, 95, 'pipeline_runtime', 'Pipeline runtime finished');

        const outputVideoUrl = String(
          outputJson?.videoUrl ||
          outputJson?.result?.videoUrl ||
          outputJson?.youtube?.videoUrl ||
          ''
        ).trim();
        const outputYoutubeVideoId = String(
          outputJson?.youtubeVideoId ||
          outputJson?.result?.youtubeVideoId ||
          outputJson?.youtube?.youtubeVideoId ||
          ''
        ).trim();
        const uploadConfirmed = !requiresUpload || Boolean(
          outputYoutubeVideoId ||
          (outputVideoUrl && /^https?:\/\//i.test(outputVideoUrl))
        );

        if (!uploadConfirmed) {
          const failedLocal = await JobModel.findOneAndUpdate(
            { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
            {
              $set: {
                status: 'failed',
                completedAt: new Date(),
                holdReleased: true,
                error: 'Upload failed or was skipped.',
                errorMessage: 'Upload failed or was skipped.',
                errorStage: 'UPLOAD',
                result: outputJson || { success: false },
                processedVideos: settings.videoCount || 1,
              },
            },
            { returnDocument: 'after' }
          );
          if (failedLocal) {
            await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);
            await appendLogSafe(jobId, `${JSON.stringify({ event: 'local_completion_failed_upload', output: outputJson || {} })}\n`, 'failed');
          }
          return;
        }

        const finalized = await JobModel.findOneAndUpdate(
          { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
          {
            $set: {
              status: 'success',
              completedAt: new Date(),
              holdConsumed: true,
              errorMessage: '',
              errorStage: undefined as any,
              result: outputJson || { success: true },
              processedVideos: settings.videoCount || 1,
            },
          },
          { returnDocument: 'after' }
        );
        if (finalized) {
          await consumeReservedCredits(userId, settings.videoCount || 1).catch(console.error);
          await updateProgressSafe(job, 100, 'completed', 'Job completed successfully');
          await appendLogSafe(jobId, `${JSON.stringify({ event: 'local_completion', output: outputJson || {} })}\n`, 'success');
        }
        return;
      }

      // Azure runner
      const AZURE_JOB_NAME = process.env.AZURE_JOB_NAME;
      const AZURE_RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP;
      const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;

      if (!AZURE_JOB_NAME || !AZURE_RESOURCE_GROUP || !AZURE_SUBSCRIPTION_ID) {
         const err: any = new Error("Azure Container App Job configuration is missing.");
         err.stage = 'RENDER';
         throw err;
      }

      console.log(`Triggering Azure Container App Job: ${AZURE_JOB_NAME}`);

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
            const updatedJob = await JobModel.findOneAndUpdate(
                { _id: jobId, status: 'processing', holdConsumed: false, holdReleased: false },
                {
                    $set: {
                        status: 'success',
                        completedAt: new Date(),
                        holdConsumed: true,
                        errorMessage: '',
                        errorStage: undefined as any,
                    }
                },
                { returnDocument: 'after' }
            );

            if (updatedJob) {
               await consumeReservedCredits(userId, settings.videoCount || 1).catch(console.error);
            }

            // Handle Story Mode increment
            if (settings.storyMode && settings.storyId) {
                try {
                   const nextPart = (settings.currentPart || 1) + 1;
                   await StoryProgress.findOneAndUpdate(
                       { userId, storyId: settings.storyId },
                       {
                           $set: {
                               lastPrompt: generatedPrompt,
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
              const updatedJob = await JobModel.findOneAndUpdate(
                  { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
                  {
                      $set: {
                          status: 'failed',
                          completedAt: new Date(),
                          holdConsumed: true,
                          error: 'YouTube Quota Exceeded (Warning Accepted)',
                          errorMessage: 'YouTube Quota Exceeded (Warning Accepted)',
                          errorStage: 'UPLOAD',
                      }
                  },
                  { returnDocument: 'after' }
              );
              if (updatedJob) {
                 await consumeReservedCredits(userId, settings.videoCount || 1).catch(console.error);
              }
            } else {
              const updatedJob = await JobModel.findOneAndUpdate(
                  { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
                  {
                      $set: {
                          status: 'failed',
                          completedAt: new Date(),
                          holdReleased: true,
                          error: 'YouTube Quota Exceeded',
                          errorMessage: 'YouTube Quota Exceeded',
                          errorStage: 'UPLOAD',
                      }
                  },
                  { returnDocument: 'after' }
              );
              if (updatedJob) {
                 await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);
              }
            }

            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video upload failed due to YouTube limits.').catch(console.error);
            }
         } else {
            const updatedJob = await JobModel.findOneAndUpdate(
                { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
                {
                    $set: {
                        status: 'failed',
                        completedAt: new Date(),
                        holdReleased: true,
                        error: 'Generation or upload failed',
                        errorMessage: 'Generation or upload failed',
                        errorStage: 'RENDER',
                    }
                },
                { returnDocument: 'after' }
            );
            if (updatedJob) {
               await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);
            }

            // FAILED (normal) - do not increment usage
            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video generation or upload failed. Please try again.').catch(console.error);
            }
         }

      } else {
         const err: any = new Error("Failed to trigger Azure Container App Job via REST API");
         err.stage = 'RENDER';
         throw err;
      }

    } catch (error: any) {
      console.error(`Error processing job ${jobId}:`, error);

      if (process.env.SENTRY_DSN) {
        Sentry.captureException(error, { extra: { jobId, userId } });
      }

      const errorDetailParts = [
        typeof error?.stderrTail === 'string' && error.stderrTail ? `[stderr-tail]\n${error.stderrTail}` : '',
        typeof error?.stdoutTail === 'string' && error.stdoutTail ? `[stdout-tail]\n${error.stdoutTail}` : '',
      ].filter(Boolean);
      const errorMsg = `\nWorker Error: ${error.message}${errorDetailParts.length ? `\n${errorDetailParts.join('\n')}` : ''}`;
      await appendLogSafe(jobId, errorMsg, 'failed');

      // Gracefully handle failure and credit release atomically
      const updatedJob = await JobModel.findOneAndUpdate(
          { _id: jobId, status: { $in: ['pending', 'processing'] } },
          {
              $set: {
                  status: 'failed',
                  completedAt: new Date(),
                  holdReleased: true,
                  error: error.message,
                  errorMessage: error.message,
                  errorStage: (error.stage === 'TOKEN' || error.stage === 'UPLOAD') ? error.stage : 'RENDER',
              }
          },
          { returnDocument: 'after' }
      );
      if (updatedJob && !updatedJob.holdConsumed) {
         await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);
      }
      if (!updatedJob) {
        await JobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              status: 'failed',
              completedAt: new Date(),
              holdReleased: true,
              error: error.message,
              errorMessage: error.message,
              errorStage: (error.stage === 'TOKEN' || error.stage === 'UPLOAD') ? error.stage : 'RENDER',
            },
          }
        ).catch((dbErr) => {
          console.error(`[PipelineWorker] Failed to force-update failed state for job ${jobId}:`, dbErr);
        });
      }

      if (error?.stage === 'TOKEN') {
        throw new UnrecoverableError(error.message || 'YouTube token failure');
      }
      if (
        error?.stage === 'RENDER' &&
        typeof error?.message === 'string' &&
        error.message.includes('Local pipeline process failed with exit code')
      ) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    } finally {
      await releaseLock(lockKey).catch((err) => console.error(`Failed to release lock for ${jobId}:`, err));
      // Decrease the channel specific hold unconditionally if the job finished/failed/was skipped
      // The `releaseReservedCredits` covers global. Channel holds are just local guards.
      const dbJob = await JobModel.findById(jobId);
      if (dbJob && dbJob.status !== 'processing' && dbJob.status !== 'pending') {
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
    lockDuration: 60000,
    stalledInterval: 30000,
    maxStalledCount: 2,
  }
);

pipelineWorker.on('completed', (job) => {
  console.log(`[PipelineWorker] BullMQ completed job ${job.id}.`);
});

pipelineWorker.on('failed', (job, err) => {
  console.error(`[PipelineWorker] Job ${job?.id} has failed in BullMQ with error: ${err.message}`, err);
});

pipelineWorker.on('stalled', (jobId) => {
  console.warn(`[PipelineWorker] Job stalled and will be retried: ${jobId}`);
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
