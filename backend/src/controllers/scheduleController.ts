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

const VideoConfigSchema = z.object({
  promptId: z.string().optional(),
  channelId: z.string().optional(),
  videoCount: z.number().optional(),
  storyMode: z.boolean().optional(),
  storyId: z.string().optional(),
  // Add other expected config options as needed, preventing arbitrary JSON injection
}).passthrough();

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

    const limitCheck = await getUploadLimits(userId);
    const planDoc = await Plan.findOne({ name: limitCheck.plan });
    if (!planDoc || !planDoc.features.scheduling) {
      throw new AppError('Scheduling is not available on your plan. Please upgrade.', 403);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const channel: any = user.youtubeChannels.find(c => c.channelId === channelId);
    if (!channel) {
      throw new AppError(`YouTube channel with ID ${channelId} not found`, 404);
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

    if (videoConfig?.channelId && videoConfig.channelId !== channelId) {
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
      channelId,
      type,
      nextRunAt,
      cron_expression,
      videoConfig: {
        ...videoConfig,
        channelId,
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

    const schedule = await Schedule.create(createPayload);

    res.status(201).json({
      success: true,
      message: 'Schedule created successfully',
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

  const schedules = await Schedule.find({ userId: req.user.id }).sort({ createdAt: -1 });
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

  res.status(200).json({
    success: true,
    message: 'Schedule deleted',
  });
});
