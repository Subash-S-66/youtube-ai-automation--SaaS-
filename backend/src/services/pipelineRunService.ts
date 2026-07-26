import { connection } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import Prompt from '../models/Prompt';
import StoryProgress from '../models/StoryProgress';
import Job from '../models/Job';
import User from '../models/User';
import SystemConfig from '../models/SystemConfig';
import { pipelineQueue } from '../queues/pipelineQueue';
import { getConsumedUploadsLast24hForChannel, getUploadLimits, releaseReservedCredits, reserveCredits } from './uploadLimitService';
import { buildStandardPrompt } from './promptBuilderService';
import { generateSubTopics } from './subTopicService';
import { decrementChannelVideosOnHold } from './channelHoldService';
import {
  buildRunnerSequence,
  getMinimumAttemptsForRunnerCycles,
  getPipelineAttemptsForPlan,
  sanitizePipelineCycleAcrossRunners,
  sanitizePipelineRetryCycles,
  sanitizePipelineRunnerFallbackOrder,
} from './pipelineRetryPolicyService';
import { getPipelineConcurrencyLimitForPlan } from './pipelineConcurrencyPolicyService';
import { resolveLocalPythonRuntime } from '../workers/localPipelineTrigger';
import {
  resolvePipelineExecutionTimeoutMs,
  sanitizeCompositionHeartbeatSeconds,
  sanitizeFfmpegCommandTimeoutSeconds,
  sanitizePipelineExecutionTimeoutMinutes,
} from './pipelineRuntimeControlService';

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
    captionAnimation?: 'fade' | 'slide_left' | 'slide_right' | 'pop' | 'none';
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

const parseTimeoutMs = (raw: unknown, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1000, Math.floor(parsed));
};

const parsePositiveInt = (raw: unknown, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const parseBoolean = (raw: unknown, fallback: boolean): boolean => {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
};

const normalizeRunner = (raw: unknown): 'local' | 'azure' | 'remote' | null => {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'azure' || normalized === 'remote') {
    return normalized;
  }
  return null;
};

const normalizePipelineServiceUrl = (value: unknown): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\/+$/, '').slice(0, 500);
};

const getMissingAzureRunnerEnv = (): string[] => {
  const missing: string[] = [];
  if (!String(process.env.AZURE_JOB_NAME || '').trim()) {
    missing.push('AZURE_JOB_NAME');
  }
  if (!String(process.env.AZURE_RESOURCE_GROUP || process.env.RESOURCE_GROUP || '').trim()) {
    missing.push('AZURE_RESOURCE_GROUP|RESOURCE_GROUP');
  }
  if (!String(process.env.AZURE_SUBSCRIPTION_ID || '').trim()) {
    missing.push('AZURE_SUBSCRIPTION_ID');
  }
  if (!String(process.env.AZURE_TENANT_ID || '').trim()) {
    missing.push('AZURE_TENANT_ID');
  }
  if (!String(process.env.AZURE_CLIENT_ID || '').trim()) {
    missing.push('AZURE_CLIENT_ID');
  }
  if (!String(process.env.AZURE_CLIENT_SECRET || '').trim()) {
    missing.push('AZURE_CLIENT_SECRET');
  }
  return missing;
};

const getMissingRemoteRunnerEnv = (serviceUrlFromConfig?: unknown): string[] => {
  const configuredUrl = normalizePipelineServiceUrl(serviceUrlFromConfig);
  const envUrl = normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL);
  const effectiveUrl = configuredUrl || envUrl;
  return effectiveUrl ? [] : ['PIPELINE_SERVICE_URL'];
};

const ensureRunnerAvailabilityOrThrow = (config: any): void => {
  const configPrimary = normalizeRunner(config?.pipelineRunner);
  const envPrimary = normalizeRunner(process.env.PIPELINE_RUNNER);
  const envPinned = parseBoolean(process.env.PIPELINE_RUNNER_PINNED, false);
  const effectivePinned = typeof config?.pipelineRunnerPinned === 'boolean'
    ? config.pipelineRunnerPinned
    : envPinned;
  const remoteConfigured = Boolean(
    normalizePipelineServiceUrl(config?.pipelineServiceUrl) || normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL)
  );
  const autoPrimary: 'local' | 'remote' = remoteConfigured ? 'remote' : 'local';
  const derivedPrimary: 'local' | 'azure' | 'remote' = effectivePinned
    ? (envPrimary || configPrimary || autoPrimary)
    : (configPrimary || envPrimary || autoPrimary);
  const fallbackOrder = sanitizePipelineRunnerFallbackOrder(config?.pipelineRunnerFallbackOrder);
  const sequence = buildRunnerSequence(derivedPrimary, fallbackOrder);

  const localRuntime = resolveLocalPythonRuntime();
  const missingAzureEnv = getMissingAzureRunnerEnv();
  const missingRemoteEnv = getMissingRemoteRunnerEnv(config?.pipelineServiceUrl);

  const availability: Record<'local' | 'azure' | 'remote', boolean> = {
    local: localRuntime.available,
    azure: missingAzureEnv.length === 0,
    remote: missingRemoteEnv.length === 0,
  };

  if (availability.local || availability.azure || availability.remote) {
    return;
  }

  const diagnostics = [
    `primaryRunner=${derivedPrimary}`,
    `runnerSequence=${sequence.join(' -> ')}`,
    `availability=${JSON.stringify(availability)}`,
    localRuntime.available
      ? ''
      : `localRuntime=${localRuntime.reason} (checked: ${localRuntime.candidates.join(', ')})`,
    missingAzureEnv.length > 0 ? `missingAzureEnv=${missingAzureEnv.join(', ')}` : '',
    missingRemoteEnv.length > 0 ? `missingRemoteEnv=${missingRemoteEnv.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  throw new AppError(
    `No available pipeline runner. ${diagnostics}`,
    503
  );
};

const SUBTOPIC_GEN_TIMEOUT_MS = parseTimeoutMs(process.env.SUBTOPIC_GEN_TIMEOUT_MS, 3000);
const QUEUE_DISPATCH_TIMEOUT_MS = parseTimeoutMs(process.env.QUEUE_DISPATCH_TIMEOUT_MS, 5000);
const CHANNEL_UPLOAD_WINDOW_CHECK_TIMEOUT_MS = parseTimeoutMs(
  process.env.CHANNEL_UPLOAD_WINDOW_CHECK_TIMEOUT_MS,
  1500
);
const PIPELINE_RETRY_CONFIG_TIMEOUT_MS = parseTimeoutMs(
  process.env.PIPELINE_RETRY_CONFIG_TIMEOUT_MS,
  1500
);
const MAX_CONCURRENT_PIPELINES_PER_USER_FALLBACK = parsePositiveInt(
  process.env.MAX_CONCURRENT_PIPELINES_PER_USER,
  10
);

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
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

    const rawCaptionAnimation = typeof rawTemplateConfig.captionAnimation === 'string'
      ? rawTemplateConfig.captionAnimation.trim().toLowerCase()
      : '';
    if (rawCaptionAnimation) {
      const captionAnimationAliases: Record<string, 'fade' | 'slide_left' | 'slide_right' | 'pop' | 'none'> = {
        fade: 'fade',
        fade_in_out: 'fade',
        shade: 'fade',
        shade_in_out: 'fade',
        slide_left: 'slide_left',
        slideleft: 'slide_left',
        left: 'slide_left',
        slide_right: 'slide_right',
        slideright: 'slide_right',
        right: 'slide_right',
        pop: 'pop',
        zoom: 'pop',
        zoom_pop: 'pop',
        none: 'none',
        static: 'none',
        off: 'none',
      };
      const normalizedCaptionAnimation = captionAnimationAliases[rawCaptionAnimation];
      if (normalizedCaptionAnimation) {
        sanitizedTemplateConfig.captionAnimation = normalizedCaptionAnimation;
      } else {
        notes.push('templateConfig.captionAnimation must be fade, slide_left, slide_right, pop, or none.');
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
  const requestedVideoCount = Math.max(1, Number(finalSettings.videoCount || 1));
  finalSettings.videoCount = requestedVideoCount;

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
    delete finalSettings.templateConfig;
  }

  if (
    (finalSettings.customVideoIds?.length || finalSettings.customImageIds?.length || finalSettings.customThumbnailId) &&
    !limitCheck.features?.custom_media
  ) {
    delete finalSettings.customVideoIds;
    delete finalSettings.customImageIds;
    delete finalSettings.customThumbnailId;
  }

  if (limitCheck.remainingUploads < requestedVideoCount) {
    throw new AppError(
      `Not enough uploads remaining. You requested ${requestedVideoCount} videos but only have ${limitCheck.remainingUploads} uploads available today.`,
      400
    );
  }

  let queueConfig: any = null;
  try {
    queueConfig = await withTimeout(
      SystemConfig.findOne()
        .sort({ updatedAt: -1 })
        .select(
          'pipelineConcurrencyByPlan pipelineRetriesByPlan pipelineRunner pipelineRunnerFallbackOrder pipelineRunnerPinned pipelineServiceUrl pipelineRetryCycles pipelineCycleAcrossRunners ffmpegCommandTimeoutSeconds compositionHeartbeatSeconds pipelineExecutionTimeoutMinutes'
        )
        .lean(),
      PIPELINE_RETRY_CONFIG_TIMEOUT_MS,
      'Pipeline queue config lookup'
    );
  } catch (error) {
    queueConfig = null;
    console.warn('[PipelineRunService] Queue config lookup timed out, using fallback limits:', error);
  }

  ensureRunnerAvailabilityOrThrow(queueConfig);

  const dynamicQueueLimit = getPipelineConcurrencyLimitForPlan(
    limitCheck.plan,
    queueConfig as any,
    MAX_CONCURRENT_PIPELINES_PER_USER_FALLBACK
  );
  const normalizedPlanLabel = String(limitCheck.displayPlan || limitCheck.plan || 'free');

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const activeJobsCount = await Job.countDocuments({
    userId,
    status: { $in: ['pending', 'processing'] },
  });

  if (activeJobsCount >= dynamicQueueLimit) {
    throw new AppError(
      `Maximum concurrent pipelines reached (${dynamicQueueLimit}) for plan ${normalizedPlanLabel}. Please wait for an existing job to finish.`,
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
    const hasAccessToken = typeof channel.tokens?.access_token === 'string' && channel.tokens.access_token.trim().length > 0;
    const hasRefreshToken = typeof channel.tokens?.refresh_token === 'string' && channel.tokens.refresh_token.trim().length > 0;
    if (!hasAccessToken && !hasRefreshToken) {
      throw new AppError(
        `youtube_token_expired: YouTube token for channel "${channel.channelName}" is invalid. Please reconnect this channel.`,
        400
      );
    }
  }

  if (channel.videosOnHold + requestedVideoCount > dynamicQueueLimit) {
    throw new AppError(
      `Cannot queue job. This channel currently has ${channel.videosOnHold} videos running/pending. Requesting ${requestedVideoCount} more exceeds the queue limit of ${dynamicQueueLimit} for plan ${normalizedPlanLabel}.`,
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
    const generatedSubTopics = await withTimeout(
      generateSubTopics(userTopic, 10, recentTopics.slice(-50)),
      SUBTOPIC_GEN_TIMEOUT_MS,
      'Sub-topic generation'
    ); // FIXED: Bound sub-topic generation latency so /api/pipeline/run stays responsive.
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

  let uploadsUsedInDailyWindow = 0;
  try {
    uploadsUsedInDailyWindow = await withTimeout(
      getConsumedUploadsLast24hForChannel(userId, selectedChannelId),
      CHANNEL_UPLOAD_WINDOW_CHECK_TIMEOUT_MS,
      'Channel upload window check'
    );
  } catch (error) {
    // This check is advisory (warning-only), so avoid blocking enqueue on slow DB aggregation.
    uploadsUsedInDailyWindow = 0;
    console.warn('[PipelineRunService] Channel upload window check timed out or failed:', error);
  }

  if (uploadsUsedInDailyWindow + requestedVideoCount > 10 && !acceptedYouTubeLimitWarning) {
    return {
      warningOnly: true,
      warning: 'YouTube daily upload limit reached for this channel (10 videos per IST day). If you continue now, upload credits may still be consumed even when YouTube rejects the upload. Continue?',
    };
  }

  if (finalSettings.storyMode && finalSettings.storyId) {
    if (finalSettings.resetStory) {
      await StoryProgress.findOneAndDelete({ userId, storyId: finalSettings.storyId });
    }
  }

    const reserved = await reserveCredits(userId, requestedVideoCount);
  if (!reserved) {
     throw new AppError('Daily upload limit reached or insufficient credits', 403);
  }

  // Atomically increment channel-specific hold only if it still fits this plan's queue cap.
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      youtubeChannels: {
        $elemMatch: {
          channelId: selectedChannelId,
          status: { $ne: 'disabled_due_to_plan' },
          videosOnHold: { $lte: Math.max(0, dynamicQueueLimit - requestedVideoCount) },
        },
      },
    },
    {
      $inc: {
        'youtubeChannels.$.videosOnHold': requestedVideoCount,
      },
    },
    { returnDocument: 'after' }
  );

  if (!updatedUser) {
    await releaseReservedCredits(userId, requestedVideoCount).catch(console.error);
    throw new AppError(
      `Cannot queue job. Queue limit is ${dynamicQueueLimit} for plan ${normalizedPlanLabel}. Please wait for pending/processing jobs to settle.`,
      400
    );
  }

  const finalLimitCheck = await getUploadLimits(userId);
  const ffmpegCommandTimeoutSeconds = sanitizeFfmpegCommandTimeoutSeconds((queueConfig as any)?.ffmpegCommandTimeoutSeconds);
  const compositionHeartbeatSeconds = sanitizeCompositionHeartbeatSeconds((queueConfig as any)?.compositionHeartbeatSeconds);
  const pipelineExecutionTimeoutMinutes = sanitizePipelineExecutionTimeoutMinutes(
    (queueConfig as any)?.pipelineExecutionTimeoutMinutes
  );

  const persistedPipelineConfig = {
    ...finalSettings,
    channelId: selectedChannelId,
    ffmpegCommandTimeoutSeconds,
    compositionHeartbeatSeconds,
    pipelineExecutionTimeoutMinutes,
  }; // FIXED: Persist runtime controls on each job so worker dispatch uses admin-selected values consistently.
  const immutableInputSnapshot = {
    promptId,
    userPrompt: String(prompt.user_prompt || '').trim(),
    geminiPrompt: String(prompt.gemini_prompt || '').trim(),
    chosenSubTopic: String(chosenSubTopic || '').trim(),
    standardizedPrompt: String(standardizedPrompt || '').trim(),
    requestedAt: new Date().toISOString(),
    uploadTargetChannelId: selectedChannelId,
    requestedVideoCount,
    acceptedYouTubeLimitWarning: !!acceptedYouTubeLimitWarning,
    settings: persistedPipelineConfig,
  };

  const timeoutVideoCount = finalSettings.videoCount || 1;
  const jobTimeoutMs = resolvePipelineExecutionTimeoutMs(pipelineExecutionTimeoutMinutes, timeoutVideoCount);
  const runtimeTimeoutLog = pipelineExecutionTimeoutMinutes === null
    ? `Runtime timeout policy: auto (${Math.round(jobTimeoutMs / 60000)}m effective)`
    : `Runtime timeout policy: ${pipelineExecutionTimeoutMinutes} minute(s)`;

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
      runtimeTimeoutLog,
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
    videoCount: requestedVideoCount,
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

  let retryConfig: any = queueConfig;
  if (!retryConfig || !retryConfig.pipelineRetriesByPlan) {
    try {
      retryConfig = await withTimeout(
        SystemConfig.findOne()
          .sort({ updatedAt: -1 })
          .select(
            'pipelineRetriesByPlan pipelineRunner pipelineRunnerFallbackOrder pipelineRunnerPinned pipelineServiceUrl pipelineRetryCycles pipelineCycleAcrossRunners ffmpegCommandTimeoutSeconds compositionHeartbeatSeconds pipelineExecutionTimeoutMinutes'
          )
          .lean(),
        PIPELINE_RETRY_CONFIG_TIMEOUT_MS,
        'Pipeline retry config lookup'
      );
    } catch (error) {
      retryConfig = null;
      console.warn('[PipelineRunService] Retry config lookup timed out, using default retry policy:', error);
    }
  }
  const baseJobAttempts = getPipelineAttemptsForPlan(finalLimitCheck.plan, retryConfig as any);
  const configPrimary = normalizeRunner((retryConfig as any)?.pipelineRunner);
  const envPrimary = normalizeRunner(process.env.PIPELINE_RUNNER);
  const pinnedByEnv = parseBoolean(process.env.PIPELINE_RUNNER_PINNED, false);
  const effectivePinned = typeof (retryConfig as any)?.pipelineRunnerPinned === 'boolean'
    ? (retryConfig as any).pipelineRunnerPinned
    : pinnedByEnv;
  const remoteConfigured = Boolean(
    String((retryConfig as any)?.pipelineServiceUrl || process.env.PIPELINE_SERVICE_URL || '').trim()
  );
  const autoPrimary: 'local' | 'remote' = remoteConfigured ? 'remote' : 'local';
  const derivedPrimary: 'local' | 'azure' | 'remote' = effectivePinned
    ? (envPrimary || configPrimary || autoPrimary)
    : (configPrimary || envPrimary || autoPrimary);
  const fallbackOrder = sanitizePipelineRunnerFallbackOrder((retryConfig as any)?.pipelineRunnerFallbackOrder);
  const runnerSequence = buildRunnerSequence(derivedPrimary, fallbackOrder);
  const retryCycles = sanitizePipelineRetryCycles((retryConfig as any)?.pipelineRetryCycles);
  const cycleAcrossRunners = sanitizePipelineCycleAcrossRunners((retryConfig as any)?.pipelineCycleAcrossRunners, true);
  const minimumCycleAttempts = cycleAcrossRunners
    ? getMinimumAttemptsForRunnerCycles(runnerSequence.length, retryCycles)
    : 1;
  const jobAttempts = Math.max(1, Math.max(baseJobAttempts, minimumCycleAttempts));
  const queueJobId = job._id.toString();

  try {
    await withTimeout(
      pipelineQueue.add(
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
          attempts: jobAttempts,
          timeout: jobTimeoutMs,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnFail: true,
        }
      ),
      QUEUE_DISPATCH_TIMEOUT_MS,
      'Queue dispatch'
    );
  } catch (queueError) {
    const rollbackCount = requestedVideoCount;

    await releaseReservedCredits(userId, rollbackCount).catch(console.error);
    await decrementChannelVideosOnHold(userId, selectedChannelId, rollbackCount).catch(console.error);

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

  if (uploadsUsedInDailyWindow + requestedVideoCount > 10) {
    result.warning = 'YouTube daily upload limit reached for this channel (10 videos per IST day). If you continue now, upload credits may still be consumed even when YouTube rejects the upload. Continue?';
  }

  return result;
};
