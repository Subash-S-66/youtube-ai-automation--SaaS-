import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import Notification from '../models/Notification';
import { AppError } from '../middleware/errorHandler';
import asyncHandler from '../utils/asyncHandler';

export const saveToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    if (!fcmToken) {
      return next(new AppError('FCM Token is required', 400));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    user.fcmToken = fcmToken;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'FCM Token saved successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    throw new AppError('Unauthorized', 401);
  }

  // Fetch notifications that target the user's plan, sorted by latest
  const notifications = await Notification.find({
    targetPlans: user.plan
  }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: notifications,
  });
});
