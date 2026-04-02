import { connection } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import Prompt from '../models/Prompt';
import StoryProgress from '../models/StoryProgress';
import Job from '../models/Job';
import User from '../models/User';
import { pipelineQueue } from '../queues/pipelineQueue';
import { getUploadLimits, releaseReservedCredits, reserveCredits } from './uploadLimitService';
import { buildStandardPrompt } from './promptBuilderService';
import { generateSubTopics } from './subTopicService';
import { ensureValidYouTubeToken } from './youtubeTokenService';

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
    captionPosition?: 'top' | 'middle' | 'bottom';
    maxWordsPerCaption?: number;
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

  const rawContentType = String(settings.contentType || '').trim().toLowerCase();
  if (rawContentType) {
    if (rawContentType === 'clips') {
      settings.contentType = 'clips';
    } else if (rawContentType === 'images') {
      settings.contentType = 'images';
    } else if (rawContentType === 'mixed') {
      settings.contentType = 'mixed';
    } else {
      settings.contentType = 'clips';
      notes.push(`Unknown contentType "${rawContentType}". Falling back to clips.`);
    }
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

  if (isObject(rawSettings.templateConfig)) {
    const rawTemplateConfig = rawSettings.templateConfig as Record<string, unknown>;
    const sanitizedTemplateConfig: NonNullable<PipelineInputSettings['templateConfig']> = {};

    const rawFontStyle = typeof rawTemplateConfig.fontStyle === 'string' ? rawTemplateConfig.fontStyle.trim() : '';
    if (rawFontStyle) {
      if (/^[a-zA-Z0-9 _-]{1,64}$/.test(rawFontStyle)) {
        sanitizedTemplateConfig.fontStyle = rawFontStyle;
      } else {
        notes.push('templateConfig.fontStyle contained unsupported characters and was ignored.');
      }
    }

    const rawSubtitleColor = typeof rawTemplateConfig.subtitleColor === 'string' ? rawTemplateConfig.subtitleColor.trim() : '';
    if (rawSubtitleColor) {
      if (/^#?[0-9a-fA-F]{6}$/.test(rawSubtitleColor)) {
        sanitizedTemplateConfig.subtitleColor = rawSubtitleColor.startsWith('#') ? rawSubtitleColor.toUpperCase() : `#${rawSubtitleColor.toUpperCase()}`;
      } else {
        notes.push('templateConfig.subtitleColor was invalid and was ignored.');
      }
    }

    const rawCaptionPosition = typeof rawTemplateConfig.captionPosition === 'string'
      ? rawTemplateConfig.captionPosition.trim().toLowerCase()
      : '';
    if (rawCaptionPosition) {
      if (rawCaptionPosition === 'top' || rawCaptionPosition === 'middle' || rawCaptionPosition === 'bottom') {
        sanitizedTemplateConfig.captionPosition = rawCaptionPosition as 'top' | 'middle' | 'bottom';
      } else {
        notes.push('templateConfig.captionPosition must be top, middle, or bottom.');
      }
    }

    const rawMaxWordsPerCaption = Number(rawTemplateConfig.maxWordsPerCaption);
    if (Number.isFinite(rawMaxWordsPerCaption) && rawMaxWordsPerCaption > 0) {
      sanitizedTemplateConfig.maxWordsPerCaption = Math.max(1, Math.min(8, Math.floor(rawMaxWordsPerCaption)));
    }

    settings.templateConfig = sanitizedTemplateConfig;
  }

  const unusedFields = [
    settings.theme ? 'theme' : '',
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
  const selectedChannelId = typeof finalSettings.channelId === 'string' ? finalSettings.channelId.trim() : ''; // FIXED: Capture selected channel id once and normalize whitespace.
  if (!selectedChannelId) { // FIXED: Fail fast when channel selection is missing.
    throw new AppError('channelId is required to enqueue a pipeline job', 400); // FIXED: Clear validation error for missing selected channel.
  }
  finalSettings.channelId = selectedChannelId; // FIXED: Persist normalized selected channel id through downstream flow.

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

  const channelBelongsToUser = user.youtubeChannels.some(
    (c) => c.channelId === finalSettings.channelId && c.status !== 'disabled_due_to_plan'
  ); // FIXED: Require selected channel ownership and active status before enqueue.
  if (!channelBelongsToUser) {
    throw new AppError('Channel does not belong to this user', 403); // FIXED: Block cross-user or disabled-channel execution attempts.
  }

  const channel = user.youtubeChannels.find((c) => c.channelId === selectedChannelId); // FIXED: Resolve user channel with exact selected channel id.
  if (!channel) {
    throw new AppError(`YouTube channel with ID ${selectedChannelId} not found`, 404); // FIXED: Report normalized selected channel id in not-found error.
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

  const uploadDisabled = (finalSettings as any).upload === false;
  if (!uploadDisabled) {
    try {
      await ensureValidYouTubeToken(selectedChannelId, userId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || '');
      throw new AppError(
        `youtube_token_expired: YouTube token for channel "${channel.channelName}" is invalid. Please reconnect this channel. ${reason}`,
        400
      );
    }
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

  const userTopic = String(prompt.user_prompt || prompt.gemini_prompt || '').trim(); // FIXED: Use original user topic as parent category for sub-topic diversification.
  const recentTopics = Array.isArray(user.recentTopics)
    ? user.recentTopics.map((topic) => String(topic || '').trim()).filter(Boolean)
    : [];
  let chosenSubTopic = userTopic; // FIXED: Keep deterministic fallback to original topic when AI sub-topic generation fails.

  try {
    const generatedSubTopics = await generateSubTopics(userTopic, 10, recentTopics.slice(-50)); // FIXED: Generate 10 distinct sub-topics while excluding recently used user topics.
    if (generatedSubTopics.length > 0) {
      const pickIndex = Math.floor(Math.random() * generatedSubTopics.length);
      chosenSubTopic = generatedSubTopics[pickIndex] || chosenSubTopic; // FIXED: Randomly pick one sub-topic for this job run.
    }
  } catch (error) {
    console.warn('[PipelineRunService] Sub-topic generation failed, falling back to base topic:', error); // FIXED: Preserve backward compatibility when sub-topic generation is unavailable.
  }

  // Queue immediately; content generation runs in background worker.
  const standardizedPrompt = buildStandardPrompt({
    prompt: chosenSubTopic,
    title: chosenSubTopic,
    duration: finalSettings.targetDuration || finalSettings.duration,
    style: finalSettings.videoStyle,
  });

  // Do not block enqueue on token refresh network calls.
  // Worker validates/refreshes channel token right before execution.

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentJobs = await Job.find({
    userId,
    channelId: selectedChannelId, // FIXED: Scope rolling upload checks to selected channel only.
    status: 'success',
    completedAt: { $gte: oneDayAgo },
  });
  const uploadsLast24h = recentJobs.reduce((sum, job) => sum + (job.videoCount || 1), 0);

  if (uploadsLast24h + finalSettings.videoCount > 10 && !acceptedYouTubeLimitWarning) {
    return {
      warningOnly: true,
      warning: 'YouTube daily upload limit reached. If you try to upload now it may not be uploaded and it will still consume your upload. Continue?',
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
    { _id: userId, 'youtubeChannels.channelId': selectedChannelId }, // FIXED: Increment hold on the exact selected channel.
    {
      $inc: {
        'youtubeChannels.$.videosOnHold': finalSettings.videoCount,
      },
    },
    { returnDocument: 'after' }
  );

  const finalLimitCheck = await getUploadLimits(userId);
  const persistedPipelineConfig = { ...finalSettings, channelId: selectedChannelId }; // FIXED: Explicitly persist selected channelId in pipelineConfig.channelId.
  const immutableInputSnapshot = {
    promptId,
    userPrompt: String(prompt.user_prompt || '').trim(),
    geminiPrompt: String(prompt.gemini_prompt || '').trim(),
    chosenSubTopic: String(chosenSubTopic || '').trim(),
    standardizedPrompt: String(standardizedPrompt || '').trim(),
    requestedAt: new Date().toISOString(),
    uploadTargetChannelId: selectedChannelId,
    requestedVideoCount: Math.max(1, Number(finalSettings.videoCount || 1)),
    acceptedYouTubeLimitWarning: !!acceptedYouTubeLimitWarning,
    settings: persistedPipelineConfig,
  };

  const jobData: Record<string, any> = {
    userId,
    promptId,
    status: 'pending',
    progress: {
      progress: 0,
      stage: 'queued',
      message: 'Job queued',
      timestamp: new Date().toISOString(),
    },
    logs: [
      'Job added to queue...',
      'Content generation deferred to background worker.',
      chosenSubTopic ? `Chosen sub-topic: ${chosenSubTopic}` : '', // FIXED: Persist selected sub-topic in logs for auditability.
      inputAudit.aliasMappings.length ? `Input alias mappings: ${inputAudit.aliasMappings.join(', ')}` : '',
      inputAudit.unusedFields.length ? `Input fields currently not used by runtime: ${inputAudit.unusedFields.join(', ')}` : '',
      inputAudit.notes.length ? `Input notes: ${inputAudit.notes.join(' | ')}` : '',
    ].filter(Boolean).join('\n') + '\n',
    topic: chosenSubTopic || prompt.user_prompt,
    chosenSubTopic: chosenSubTopic || undefined,
    generatedPrompt: standardizedPrompt || chosenSubTopic || prompt.gemini_prompt,
    generatedScript: [],
    captions: [],
    title: '',
    description: '',
    hashtags: [],
    generatedScenes: [],
    generatedMetadata: [],
    preparedContent: [],
    pipelineConfig: persistedPipelineConfig, // FIXED: Store canonical selected channel id in job pipeline config.
    inputSnapshot: immutableInputSnapshot,
    result: {
      status: 'queued',
      queuedAt: new Date().toISOString(),
      inputSnapshot: immutableInputSnapshot,
    },
    youtubeAccountId: selectedChannelId, // FIXED: Keep legacy field aligned with selected channel for backward compatibility.
    acceptedYouTubeLimitWarning: !!acceptedYouTubeLimitWarning,
    videoCount: finalSettings.videoCount,
    channelId: selectedChannelId, // FIXED: Persist selected channel id at top-level job field.
    customVideoIds: finalSettings.customVideoIds || [],
    customImageIds: finalSettings.customImageIds || [],
  };

  if (finalSettings.customThumbnailId) {
    jobData.customThumbnailId = finalSettings.customThumbnailId;
  }

  jobData.queuedAt = new Date();

  const job = await Job.create(jobData);

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

  try {
    await pipelineQueue.add(
      'runPipeline',
      {
        userId,
        promptId,
        jobId: job._id.toString(),
        settings: persistedPipelineConfig, // FIXED: Forward settings with explicit selected channel id for worker parity.
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
        removeOnFail: true,
      }
    );
  } catch (queueError) {
    const rollbackCount = Math.max(1, Number(finalSettings.videoCount || 1));

    await releaseReservedCredits(userId, rollbackCount).catch(console.error);
    await User.updateOne(
      { _id: userId, 'youtubeChannels.channelId': selectedChannelId, 'youtubeChannels.videosOnHold': { $gte: rollbackCount } },
      { $inc: { 'youtubeChannels.$.videosOnHold': -rollbackCount } }
    ).catch(console.error);

    await Job.findByIdAndUpdate(job._id, {
      status: 'failed',
      completedAt: new Date(),
      holdReleased: true,
      error: 'Queue dispatch failed',
      errorMessage: 'Queue dispatch failed',
      errorStage: 'RENDER',
      progress: {
        progress: 100,
        stage: 'failed',
        message: 'Queue dispatch failed',
        timestamp: new Date().toISOString(),
      },
      result: {
        success: false,
        stage: 'RENDER',
        message: 'Queue dispatch failed',
        error: String((queueError as Error)?.message || queueError || ''),
        failedAt: new Date().toISOString(),
      },
    }).catch(console.error);

    throw new AppError('Failed to dispatch pipeline job. Please try again.', 500);
  }

  if (idempotencyKey && connection) {
    await connection.set(`idempotency:job:${idempotencyKey}`, job._id.toString(), 'EX', 24 * 60 * 60); // 24 hour expiry
  }

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
    result.warning = 'YouTube daily upload limit reached. If you try to upload now it may not be uploaded and it will still consume your upload. Continue?';
  }

  return result;
};
