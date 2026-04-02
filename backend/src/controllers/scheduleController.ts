import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Schedule from '../models/Schedule';
import Prompt from '../models/Prompt';
import User from '../models/User';
import Plan from '../models/Plan';
import { CreateScheduleInput } from '../utils/validators/scheduleValidators';
import { getUploadLimits } from '../services/uploadLimitService';
import { scheduleQueue } from '../queues/scheduleQueue';
import { z } from 'zod';

const SCHEDULE_QUEUE_STATES: Array<'waiting' | 'delayed'> = ['waiting', 'delayed'];

const clearQueuedScheduleJobs = async (scheduleId: string): Promise<void> => {
  const queuedJobs = await scheduleQueue.getJobs(SCHEDULE_QUEUE_STATES);
  const matchingJobs = queuedJobs.filter((job: any) => job?.data?.scheduleId === scheduleId);
  await Promise.all(
    matchingJobs.map((job: any) => job.remove().catch(() => undefined))
  );
};

const enqueueScheduleRun = async (scheduleId: string, nextRunAt: Date): Promise<void> => {
  await clearQueuedScheduleJobs(scheduleId);
  await scheduleQueue.add(
    'runSchedule',
    { scheduleId },
    {
      delay: Math.max(0, nextRunAt.getTime() - Date.now()),
      jobId: `schedule-${scheduleId}-${nextRunAt.getTime()}`,
    }
  );
};

const VideoConfigSchema = z.object({
  promptId: z.string().optional(),
  channelId: z.string().optional(),
  targetDuration: z.number().optional(),
  duration: z.number().optional(),
  contentType: z.enum(['clips', 'images', 'mixed']).optional(),
  videoCount: z.number().optional(),
  upload: z.boolean().optional(),
  publishNow: z.boolean().optional(),
  storyMode: z.boolean().optional(),
  storyId: z.string().optional(),
  currentPart: z.number().optional(),
  recapEnabled: z.boolean().optional(),
  ctaEnabled: z.boolean().optional(),
  voices: z.array(z.string()).optional(),
  templateConfig: z.object({
    fontStyle: z.string().optional(),
    subtitleColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
    captionPosition: z.enum(['top', 'middle', 'bottom']).optional(),
    captionAnimation: z.enum(['fade', 'slide_left', 'slide_right', 'pop', 'none']).optional(),
    maxWordsPerCaption: z.number().int().min(1).max(8).optional(),
  }).optional(),
  customVideoIds: z.array(z.string().max(100)).max(50).optional(),
  customImageIds: z.array(z.string().max(100)).max(50).optional(),
  customThumbnailId: z.string().max(100).optional(),
  userMediaPaths: z.array(z.string()).optional(),
  lastPrompt: z.string().optional(),
  theme: z.string().optional(),
  videoStyle: z.string().optional(),
  enableCTA: z.boolean().optional(),
  voice: z.string().optional(),
  voiceRate: z.string().optional(),
  musicVolume: z.number().optional(),
  useImages: z.boolean().optional(),
}).passthrough(); // FIXED: Preserve validated user config fields for delayed schedule execution.

// @desc    Create a schedule
// @route   POST /api/schedules
// @access  Private
export const createSchedule = asyncHandler(
  async (req: Request<unknown, unknown, CreateScheduleInput>, res: Response) => {
    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    const userId = req.user.id;
    const {
      channelId,
      type,
      datetime,
      intervalHours,
      videosPerInterval,
      cron_expression,
      videoConfig,
    } = req.body;
    const normalizedChannelId = String(channelId || '').trim();

    const limitCheck = await getUploadLimits(userId);
    const planDoc = await Plan.findOne({ name: limitCheck.plan });
    if (!planDoc || !planDoc.features.scheduling) {
      throw new AppError('Scheduling is not available on your plan. Please upgrade.', 403);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const channel: any = user.youtubeChannels.find(c => c.channelId === normalizedChannelId);
    if (!channel) {
      throw new AppError(`YouTube channel with ID ${normalizedChannelId} not found`, 404);
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

    const promptId = videoConfig?.promptId;
    if (promptId) {
      const prompt = await Prompt.findById(promptId);
      if (!prompt) {
        throw new AppError('Prompt not found', 404);
      }
      if (prompt.userId.toString() !== userId) {
        throw new AppError('Prompt does not belong to user', 403);
      }
    }

    if (videoConfig?.channelId && String(videoConfig.channelId).trim() !== normalizedChannelId) {
      throw new AppError('channelId mismatch between schedule and videoConfig', 400);
    }

    const now = new Date();
    let nextRunAt: Date | undefined;
    let resolvedVideoCount = Number(videoConfig?.videoCount || 1);

    // Enforce schema validation on videoConfig to avoid arbitrary JSON injection
    const validatedVideoConfig = videoConfig ? VideoConfigSchema.parse(videoConfig) : undefined;

    if (type === 'one-time') {
      if (!datetime) {
        throw new AppError('datetime is required for one-time schedules', 400);
      }
      if (datetime.getTime() <= now.getTime()) {
        throw new AppError('Schedule time must be in the future', 400);
      }
      nextRunAt = datetime;
    } else if (type === 'interval') {
      if (!intervalHours || !videosPerInterval) {
        throw new AppError('intervalHours and videosPerInterval are required for interval schedules', 400);
      }
      nextRunAt = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
      resolvedVideoCount = videosPerInterval;
    } else {
      if (!cron_expression && !intervalHours) {
        throw new AppError('cron_expression or intervalHours is required for recurring schedules', 400);
      }
      nextRunAt = datetime || new Date(now.getTime() + 60 * 1000);
      if (videosPerInterval) {
        resolvedVideoCount = videosPerInterval;
      }
    }

    if (resolvedVideoCount > 10) {
      throw new AppError('Maximum 10 videos per request', 400);
    }

    const createPayload: Record<string, any> = {
      userId,
      channelId: normalizedChannelId,
      type,
      nextRunAt,
      cron_expression,
      videoConfig: {
        ...validatedVideoConfig,
        channelId: normalizedChannelId,
        videoCount: resolvedVideoCount,
      },
    };
    if (type === 'one-time') {
      createPayload.datetime = datetime;
    }
    if (type === 'interval' || type === 'recurring') {
      if (intervalHours) createPayload.intervalHours = intervalHours;
      if (videosPerInterval) createPayload.videosPerInterval = videosPerInterval;
    }

    // Keep interval/recurring schedules channel-specific and singular while allowing many one-time schedules.
    let schedule = null;
    if (type === 'interval' || type === 'recurring') {
      schedule = await Schedule.findOne({
        userId,
        channelId: normalizedChannelId,
        type,
        enabled: true,
      });
      if (schedule) {
        const setPayload: Record<string, any> = {
          nextRunAt,
          videoConfig: createPayload.videoConfig,
          running: false,
          enabled: true,
          status: 'pending',
        };
        const unsetPayload: Record<string, number> = {
          lastError: 1,
        };

        if (intervalHours !== undefined) {
          setPayload.intervalHours = intervalHours;
        } else {
          unsetPayload.intervalHours = 1;
        }

        if (videosPerInterval !== undefined) {
          setPayload.videosPerInterval = videosPerInterval;
        } else {
          unsetPayload.videosPerInterval = 1;
        }

        if (cron_expression !== undefined) {
          setPayload.cron_expression = cron_expression;
        } else {
          unsetPayload.cron_expression = 1;
        }

        schedule = await Schedule.findByIdAndUpdate(
          schedule._id,
          {
            $set: setPayload,
            $unset: unsetPayload,
          },
          { new: true }
        );
      }
    }

    if (!schedule) {
      schedule = await Schedule.create(createPayload);
    }

    // Enqueue delayed job
    if (nextRunAt) {
      await enqueueScheduleRun(schedule._id.toString(), nextRunAt);
    }

    res.status(201).json({
      success: true,
      message: type === 'interval' || type === 'recurring'
        ? 'Channel schedule saved successfully'
        : 'Schedule created successfully',
      data: schedule,
    });
  }
);

// @desc    Get schedules
// @route   GET /api/schedules
// @access  Private
export const getSchedules = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const channelId = typeof req.query.channelId === 'string' ? req.query.channelId.trim() : '';
  const query: Record<string, any> = { userId: req.user.id };
  if (channelId) {
    query.channelId = channelId;
  }

  const schedules = await Schedule.find(query).sort({ createdAt: -1 });
  res.status(200).json({
    success: true,
    data: schedules,
  });
});

// @desc    Delete a schedule
// @route   DELETE /api/schedules/:id
// @access  Private
export const deleteSchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const scheduleId = String(req.params.id);
  const schedule = await Schedule.findOneAndDelete({ _id: scheduleId, userId: req.user.id } as any);
  if (!schedule) {
    throw new AppError('Schedule not found', 404);
  }

  await clearQueuedScheduleJobs(scheduleId);

  res.status(200).json({
    success: true,
    message: 'Schedule deleted',
  });
});
