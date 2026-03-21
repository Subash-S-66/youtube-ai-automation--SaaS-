import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Schedule from '../models/Schedule';
import Plan from '../models/Plan';
import User from '../models/User';
import { getUploadLimits } from '../services/uploadLimitService';

export const createSchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const { channelId, type, datetime, cron_expression, videoConfig } = req.body;
  const userId = req.user.id;

  const limitCheck = await getUploadLimits(userId);
  const planDoc = await Plan.findOne({ name: limitCheck.plan });

  if (!planDoc || !planDoc.features.scheduling) {
    throw new AppError('Scheduling is not available on your plan. Please upgrade.', 403);
  }

  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404);

  const channel = user.youtubeChannels.find((c: any) => c.channelId === channelId);
  if (!channel) throw new AppError('Channel not found', 404);
  if (channel.status === 'disabled_due_to_plan') throw new AppError('Channel disabled due to plan downgrade. Please upgrade.', 403);

  const schedule = await Schedule.create({
    userId,
    channelId,
    type,
    datetime,
    cron_expression,
    videoConfig,
  });

  res.status(201).json({
    success: true,
    data: schedule,
  });
});

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

export const deleteSchedule = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const { id } = req.params;
  if (!id) throw new AppError('Schedule ID missing', 400);

  const schedule = await Schedule.findOneAndDelete({ _id: id, userId: req.user.id });
  if (!schedule) {
    throw new AppError('Schedule not found', 404);
  }

  res.status(200).json({
    success: true,
    message: 'Schedule deleted',
  });
});
