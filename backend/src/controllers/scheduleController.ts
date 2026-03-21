import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Schedule from '../models/Schedule';
import Prompt from '../models/Prompt';
import User from '../models/User';
import { CreateScheduleInput } from '../utils/validators/scheduleValidators';
import { getUploadLimits } from '../services/uploadLimitService';

// @desc    Create a schedule
// @route   POST /api/schedules
// @access  Private
export const createSchedule = asyncHandler(
  async (req: Request<unknown, unknown, CreateScheduleInput>, res: Response) => {
    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    const userId = req.user.id;
    const { channelId, type, datetime, intervalHours, videosPerInterval, videoConfig } = req.body;

    const limitCheck = await getUploadLimits(userId);
    if (limitCheck.plan === 'free') {
      throw new AppError('Scheduling is not available on the Free plan. Please upgrade to Basic or higher.', 403);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const channel = user.youtubeChannels.find(c => c.channelId === channelId);
    if (!channel) {
      throw new AppError(`YouTube channel with ID ${channelId} not found`, 404);
    }

    const promptId = videoConfig?.promptId;
    if (!promptId) {
      throw new AppError('promptId is required', 400);
    }

    const prompt = await Prompt.findById(promptId);
    if (!prompt) {
      throw new AppError('Prompt not found', 404);
    }
    if (prompt.userId.toString() !== userId) {
      throw new AppError('Prompt does not belong to user', 403);
    }

    if (videoConfig?.channelId && videoConfig.channelId !== channelId) {
      throw new AppError('channelId mismatch between schedule and videoConfig', 400);
    }

    const now = new Date();
    let nextRunAt: Date;
    let resolvedVideoCount = Number(videoConfig?.videoCount || 1);

    if (type === 'one-time') {
      if (!datetime) {
        throw new AppError('datetime is required for one-time schedules', 400);
      }
      if (datetime.getTime() <= now.getTime()) {
        throw new AppError('Schedule time must be in the future', 400);
      }
      nextRunAt = datetime;
    } else {
      if (!intervalHours || !videosPerInterval) {
        throw new AppError('intervalHours and videosPerInterval are required for interval schedules', 400);
      }
      nextRunAt = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
      resolvedVideoCount = videosPerInterval;
    }

    if (resolvedVideoCount > 10) {
      throw new AppError('Maximum 10 videos per request', 400);
    }

    const schedule = await Schedule.create({
      userId,
      channelId,
      type,
      datetime: type === 'one-time' ? datetime : undefined,
      intervalHours: type === 'interval' ? intervalHours : undefined,
      videosPerInterval: type === 'interval' ? videosPerInterval : undefined,
      nextRunAt,
      videoConfig: {
        ...videoConfig,
        channelId,
        videoCount: resolvedVideoCount,
      },
    });

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

  const schedule = await Schedule.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!schedule) {
    throw new AppError('Schedule not found', 404);
  }

  res.status(200).json({
    success: true,
    message: 'Schedule deleted',
  });
});
