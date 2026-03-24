import { AppError } from '../middleware/errorHandler';
import Prompt from '../models/Prompt';
import StoryProgress from '../models/StoryProgress';
import Job from '../models/Job';
import User from '../models/User';
import { pipelineQueue } from '../queues/pipelineQueue';
import { getUploadLimits } from './uploadLimitService';
import { getValidYouTubeToken } from './youtubeTokenService';

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
}

export const enqueuePipelineJob = async ({
  userId,
  promptId,
  settings,
  acceptedYouTubeLimitWarning = false,
}: EnqueuePipelineParams): Promise<EnqueuePipelineResult> => {
  // Global Emergency Stop for cost control / safety
  if (process.env.EMERGENCY_STOP === 'true') {
    throw new AppError('Pipeline generation is temporarily paused for maintenance.', 503);
  }

  const limitCheck = await getUploadLimits(userId);
  if (!limitCheck.canUpload) {
    throw new AppError('Daily upload limit reached', 403);
  }

  if (limitCheck.plan === 'free') {
    if (settings.storyMode) {
      throw new AppError('Story Mode is not available on the Free plan. Please upgrade to Basic or higher.', 403);
    }
    if ((settings as any).scheduledAt || (settings as any).scheduleEnabled) {
      throw new AppError('Scheduling is not available on the Free plan. Please upgrade to Basic or higher.', 403);
    }
  }

  // Prevent unbounded story growth
  if (settings.storyMode && settings.currentPart && Number(settings.currentPart) > 100) {
    throw new AppError(
      'Story has reached the maximum of 100 parts. Please reset your story to start a new one.',
      400
    );
  }

  if (settings.templateConfig && !limitCheck.features?.template_customization) {
    throw new AppError('Template Customization is only available on Pro and Premium plans.', 403);
  }

  if ((settings.customVideoIds?.length || settings.customImageIds?.length) && !limitCheck.features?.custom_media) {
    throw new AppError('Custom Media is only available on Pro and Premium plans.', 403);
  }

  if (limitCheck.remainingUploads < settings.videoCount) {
    throw new AppError(
      `Not enough uploads remaining. You requested ${settings.videoCount} videos but only have ${limitCheck.remainingUploads} uploads available today.`,
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
    status: { $in: ['pending', 'running'] },
  });

  if (activeJobsCount >= maxConcurrentJobs) {
    throw new AppError(
      `Maximum concurrent jobs reached for your plan (${maxConcurrentJobs}). Please wait for an existing job to finish.`,
      400
    );
  }

  const channel = user.youtubeChannels.find(c => c.channelId === settings.channelId);
  if (!channel) {
    throw new AppError(`YouTube channel with ID ${settings.channelId} not found`, 404);
  }

  if (channel.videosOnHold + settings.videoCount > 10) {
    throw new AppError(
      `Cannot queue job. This channel currently has ${channel.videosOnHold} videos running/pending. Requesting ${settings.videoCount} more exceeds the strict limit of 10 per channel.`,
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

  let youtubeToken = '';
  try {
    youtubeToken = await getValidYouTubeToken(userId, settings.channelId);
  } catch {
    throw new AppError('youtube_token_expired', 400);
  }

  if (!youtubeToken) {
    throw new AppError('youtube_token_expired', 400);
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentJobs = await Job.find({
    userId,
    channelId: settings.channelId,
    status: 'success',
    createdAt: { $gte: oneDayAgo },
  });
  const uploadsLast24h = recentJobs.reduce((sum, job) => sum + (job.videoCount || 1), 0);

  if (uploadsLast24h + settings.videoCount > 10 && !acceptedYouTubeLimitWarning) {
    return {
      warningOnly: true,
      warning: 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?',
    };
  }

  if (settings.storyMode && settings.storyId) {
    if (settings.resetStory) {
      await StoryProgress.findOneAndDelete({ userId, storyId: settings.storyId });
    }
  }

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, 'youtubeChannels.channelId': settings.channelId },
    {
      $inc: {
        uploadsOnHold: settings.videoCount,
        'youtubeChannels.$.videosOnHold': settings.videoCount,
      },
    },
    { returnDocument: 'after' }
  );

  const finalLimitCheck = await getUploadLimits(userId);

  const job = await Job.create({
    userId,
    promptId,
    status: 'pending',
    logs: 'Job added to queue...\n',
    acceptedYouTubeLimitWarning: !!acceptedYouTubeLimitWarning,
    videoCount: settings.videoCount,
    channelId: settings.channelId,
    customVideoIds: settings.customVideoIds || [],
    customImageIds: settings.customImageIds || [],
    customThumbnailId: settings.customThumbnailId || undefined,
  });

  const planPriorities: Record<string, number> = {
    premium: 1,
    pro: 2,
    basic: 3,
    free: 4,
  };
  const jobPriority = planPriorities[finalLimitCheck.plan] || 4;

  const count = settings.videoCount || 1;
  const jobTimeoutMinutes = 10 + (count - 1) * 5;
  const jobTimeoutMs = jobTimeoutMinutes * 60 * 1000;

  await pipelineQueue.add(
    'runPipeline',
    {
      userId,
      promptId,
      jobId: job._id.toString(),
      settings,
    },
    {
      priority: jobPriority,
      jobId: job._id.toString(),
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
  };

  if (uploadsLast24h + settings.videoCount > 10) {
    result.warning = 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?';
  }

  return result;
};
