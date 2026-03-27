import { connection } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import Prompt from '../models/Prompt';
import StoryProgress from '../models/StoryProgress';
import Job from '../models/Job';
import User from '../models/User';
import { pipelineQueue } from '../queues/pipelineQueue';
import { getUploadLimits, reserveCredits } from './uploadLimitService';
import { buildStandardPrompt } from './promptBuilderService';

export interface PipelineInputSettings {
  targetDuration?: number;
  duration?: number;
  contentType?: 'clips' | 'images' | 'mixed';
  videoCount: number;
  channelId: string;
  storyMode?: boolean;
  storyId?: string;
  currentPart?: number;
  recapEnabled?: boolean;
  ctaEnabled?: boolean;
  voices?: string[];
  resetStory?: boolean;
  userMediaPaths?: string[];
  lastPrompt?: string;
  templateConfig?: {
    fontStyle?: string;
    subtitleColor?: string;
  };
  customVideoIds?: string[];
  customImageIds?: string[];
  customThumbnailId?: string;
  theme?: string;
  videoStyle?: string;
  enableCTA?: boolean;
  voice?: string;
  voiceRate?: string;
  musicVolume?: number;
  useImages?: boolean;
}

export interface PipelineInput {
  userId: string;
  promptId: string;
  settings: PipelineInputSettings;
  acceptedYouTubeLimitWarning?: boolean;
}

export interface PipelineInputAudit {
  normalizedSettings: PipelineInputSettings;
  aliasMappings: string[];
  unusedFields: string[];
  notes: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

export const normalizePipelineSettings = (rawSettings: Record<string, any>): PipelineInputAudit => {
  const settings: PipelineInputSettings = { ...rawSettings } as PipelineInputSettings;
  const aliasMappings: string[] = [];
  const notes: string[] = [];

  if (typeof settings.voice === 'string' && settings.voice.trim() && (!settings.voices || settings.voices.length === 0)) {
    settings.voices = [settings.voice.trim()];
    aliasMappings.push('voice -> voices[0]');
  }

  if (typeof settings.enableCTA === 'boolean' && typeof settings.ctaEnabled !== 'boolean') {
    settings.ctaEnabled = settings.enableCTA;
    aliasMappings.push('enableCTA -> ctaEnabled');
  }

  if (typeof settings.useImages === 'boolean' && !settings.contentType) {
    settings.contentType = settings.useImages ? 'images' : 'clips';
    aliasMappings.push('useImages -> contentType');
  }

  if (!settings.contentType) {
    settings.contentType = 'clips';
  }

  if (!settings.targetDuration && settings.duration) {
    notes.push('duration provided without targetDuration; duration will drive script length.');
  }

  if (settings.targetDuration && settings.duration && settings.targetDuration !== settings.duration) {
    notes.push('Both targetDuration and duration were provided; targetDuration takes precedence in pipeline runtime.');
  }

  if (settings.storyMode && !settings.storyId) {
    throw new AppError('storyId is required when storyMode is enabled.', 400);
  }

  if (settings.resetStory && !settings.storyId) {
    throw new AppError('storyId is required when resetStory is enabled.', 400);
  }

  if (!isObject(rawSettings.templateConfig) && rawSettings.templateConfig !== undefined) {
    throw new AppError('templateConfig must be an object when provided.', 400);
  }

  const unusedFields = [
    settings.customVideoIds?.length ? 'customVideoIds' : '',
    settings.customImageIds?.length ? 'customImageIds' : '',
    settings.customThumbnailId ? 'customThumbnailId' : '',
    settings.theme ? 'theme' : '',
    settings.videoStyle ? 'videoStyle' : '',
    settings.voiceRate ? 'voiceRate' : '',
    settings.musicVolume !== undefined ? 'musicVolume' : '',
  ].filter(Boolean);

  return {
    normalizedSettings: settings,
    aliasMappings,
    unusedFields,
    notes,
  };
};

export interface EnqueuePipelineParams {
  userId: string;
  promptId: string;
  settings: Record<string, any>;
  acceptedYouTubeLimitWarning?: boolean;
}

export interface EnqueuePipelineResult {
  warning?: string;
  warningOnly?: boolean;
  jobId?: string;
  plan?: string;
  remainingUploads?: number;
  uploadsOnHold?: number;
  standardizedPrompt?: string;
  generatedScript?: Array<Array<{ text: string; duration?: number }>>;
  metadata?: {
    title: string;
    description: string;
    hashtags: string[];
  };
}

export const enqueuePipelineJob = async ({
  userId,
  promptId,
  settings,
  acceptedYouTubeLimitWarning = false,
  idempotencyKey,
}: EnqueuePipelineParams & { idempotencyKey?: string }): Promise<EnqueuePipelineResult> => {

  if (idempotencyKey && connection) {
    const existingJobId = await connection.get(`idempotency:job:${idempotencyKey}`);
    if (existingJobId) {
      const existingJob = await Job.findById(existingJobId);
      if (existingJob) {
        return {
          jobId: existingJob._id.toString(),
          plan: existingJob.pipelineConfig?.plan || 'free',
          remainingUploads: 0, // Mocked for cached response
          uploadsOnHold: 0,
          standardizedPrompt: existingJob.generatedPrompt || '',
          generatedScript: existingJob.generatedScript || [],
          metadata: {
            title: existingJob.title || '',
            description: existingJob.description || '',
            hashtags: existingJob.hashtags || [],
          },
        };
      }
    }
  }

  const inputAudit = normalizePipelineSettings(settings as Record<string, any>);
  const finalSettings = inputAudit.normalizedSettings;

  // Global Emergency Stop for cost control / safety
  if (process.env.EMERGENCY_STOP === 'true') {
    throw new AppError('Pipeline generation is temporarily paused for maintenance.', 503);
  }

  const limitCheck = await getUploadLimits(userId);
  if (!limitCheck.canUpload) {
    throw new AppError('Daily upload limit reached', 403);
  }

  if (limitCheck.plan === 'free') {
    if (finalSettings.storyMode) {
      throw new AppError('Story Mode is not available on the Free plan. Please upgrade to Basic or higher.', 403);
    }
    if ((finalSettings as any).scheduledAt || (finalSettings as any).scheduleEnabled) {
      throw new AppError('Scheduling is not available on the Free plan. Please upgrade to Basic or higher.', 403);
    }
  }

  // Prevent unbounded story growth
  if (finalSettings.storyMode && finalSettings.currentPart && Number(finalSettings.currentPart) > 100) {
    throw new AppError(
      'Story has reached the maximum of 100 parts. Please reset your story to start a new one.',
      400
    );
  }

  if (finalSettings.templateConfig && !limitCheck.features?.template_customization) {
    throw new AppError('Template Customization is only available on Pro and Premium plans.', 403);
  }

  if (
    (finalSettings.customVideoIds?.length || finalSettings.customImageIds?.length || finalSettings.customThumbnailId) &&
    !limitCheck.features?.custom_media
  ) {
    throw new AppError('Custom Media is only available on Pro and Premium plans.', 403);
  }

  if (limitCheck.remainingUploads < finalSettings.videoCount) {
    throw new AppError(
      `Not enough uploads remaining. You requested ${finalSettings.videoCount} videos but only have ${limitCheck.remainingUploads} uploads available today.`,
      400
    );
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const concurrentLimits = {
    free: 1,
    basic: 3,
    pro: 10,
    premium: 20,
  };
  const maxConcurrentJobs = (concurrentLimits as any)[limitCheck.plan] || 1;

  const activeJobsCount = await Job.countDocuments({
    userId,
    status: { $in: ['pending', 'processing'] },
  });

  if (activeJobsCount >= maxConcurrentJobs) {
    throw new AppError(
      `Maximum concurrent jobs reached for your plan (${maxConcurrentJobs}). Please wait for an existing job to finish.`,
      400
    );
  }

  const channel = user.youtubeChannels.find(c => c.channelId === finalSettings.channelId);
  if (!channel) {
    throw new AppError(`YouTube channel with ID ${finalSettings.channelId} not found`, 404);
  }
  if (channel.isValid === false) {
    throw new AppError(
      `youtube_token_expired: YouTube token for channel "${channel.channelName}" is invalid. Please reconnect this channel.`,
      400
    );
  }
  if (channel.status === 'disabled_due_to_plan') {
    throw new AppError('Channel disabled due to plan downgrade. Please upgrade.', 403);
  }

  if (channel.videosOnHold + finalSettings.videoCount > 10) {
    throw new AppError(
      `Cannot queue job. This channel currently has ${channel.videosOnHold} videos running/pending. Requesting ${finalSettings.videoCount} more exceeds the strict limit of 10 per channel.`,
      400
    );
  }

  const prompt = await Prompt.findById(promptId);
  if (!prompt) {
    throw new AppError('Prompt not found', 404);
  }

  if (prompt.userId.toString() !== userId) {
    throw new AppError('Prompt does not belong to user', 403);
  }

  // Queue immediately; content generation runs in background worker.
  const standardizedPrompt = buildStandardPrompt({
    prompt: prompt.gemini_prompt || prompt.user_prompt,
    title: prompt.user_prompt,
    duration: finalSettings.targetDuration || finalSettings.duration,
    style: finalSettings.videoStyle,
  });

  // Do not block enqueue on token refresh network calls.
  // Worker validates/refreshes channel token right before execution.

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentJobs = await Job.find({
    userId,
    channelId: finalSettings.channelId,
    status: 'success',
    createdAt: { $gte: oneDayAgo },
  });
  const uploadsLast24h = recentJobs.reduce((sum, job) => sum + (job.videoCount || 1), 0);

  if (uploadsLast24h + finalSettings.videoCount > 10 && !acceptedYouTubeLimitWarning) {
    return {
      warningOnly: true,
      warning: 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?',
    };
  }

  if (finalSettings.storyMode && finalSettings.storyId) {
    if (finalSettings.resetStory) {
      await StoryProgress.findOneAndDelete({ userId, storyId: finalSettings.storyId });
    }
  }

  const reserved = await reserveCredits(userId, finalSettings.videoCount);
  if (!reserved) {
     throw new AppError('Daily upload limit reached or insufficient credits', 403);
  }

  // Still increment channel-specific hold
  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, 'youtubeChannels.channelId': finalSettings.channelId },
    {
      $inc: {
        'youtubeChannels.$.videosOnHold': finalSettings.videoCount,
      },
    },
    { returnDocument: 'after' }
  );

  const finalLimitCheck = await getUploadLimits(userId);

  const jobData: Record<string, any> = {
    userId,
    promptId,
    status: 'pending',
    logs: [
      'Job added to queue...',
      'Content generation deferred to background worker.',
      inputAudit.aliasMappings.length ? `Input alias mappings: ${inputAudit.aliasMappings.join(', ')}` : '',
      inputAudit.unusedFields.length ? `Input fields currently not used by runtime: ${inputAudit.unusedFields.join(', ')}` : '',
      inputAudit.notes.length ? `Input notes: ${inputAudit.notes.join(' | ')}` : '',
    ].filter(Boolean).join('\n') + '\n',
    topic: prompt.user_prompt,
    generatedPrompt: standardizedPrompt || prompt.gemini_prompt,
    generatedScript: [],
    captions: [],
    title: '',
    description: '',
    hashtags: [],
    generatedScenes: [],
    generatedMetadata: [],
    preparedContent: [],
    pipelineConfig: finalSettings,
    youtubeAccountId: finalSettings.channelId,
    acceptedYouTubeLimitWarning: !!acceptedYouTubeLimitWarning,
    videoCount: finalSettings.videoCount,
    channelId: finalSettings.channelId,
    customVideoIds: finalSettings.customVideoIds || [],
    customImageIds: finalSettings.customImageIds || [],
  };

  if (finalSettings.customThumbnailId) {
    jobData.customThumbnailId = finalSettings.customThumbnailId;
  }

  jobData.queuedAt = new Date();

  const job = await Job.create(jobData);

  if (idempotencyKey && connection) {
    await connection.set(`idempotency:job:${idempotencyKey}`, job._id.toString(), 'EX', 24 * 60 * 60); // 24 hour expiry
  }

  const planPriorities: Record<string, number> = {
    premium: 1,
    pro: 2,
    basic: 3,
    free: 4,
  };
  const jobPriority = planPriorities[finalLimitCheck.plan] || 4;

  const count = finalSettings.videoCount || 1;
  const jobTimeoutMinutes = 10 + (count - 1) * 5;
  const jobTimeoutMs = jobTimeoutMinutes * 60 * 1000;
  const queueJobId = `${userId}-${promptId}-${Date.now()}`;

  await pipelineQueue.add(
    'runPipeline',
    {
      userId,
      promptId,
      jobId: job._id.toString(),
      settings: finalSettings, // worker re-reads canonical config from DB before dispatch
    },
    {
      priority: jobPriority,
      jobId: queueJobId,
      attempts: 3,
      timeout: jobTimeoutMs,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );

  const result: EnqueuePipelineResult = {
    jobId: job._id.toString(),
    plan: finalLimitCheck.plan,
    remainingUploads: finalLimitCheck.remainingUploads,
    uploadsOnHold: updatedUser?.uploadsOnHold || 0,
    standardizedPrompt,
    generatedScript: [],
    metadata: {
      title: '',
      description: '',
      hashtags: [],
    },
  };

  if (uploadsLast24h + finalSettings.videoCount > 10) {
    result.warning = 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?';
  }

  return result;
};
