import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import User from '../models/User';
import Job from '../models/Job';
import Prompt from '../models/Prompt';
import { z } from 'zod';
import { PLAN_LIMITS } from '../config/plans';

export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const totalUsers = await User.countDocuments();
  const totalActiveSubscriptions = await User.countDocuments({
    subscriptionStatus: 'active',
    subscriptionExpiresAt: { $gt: new Date() },
  });

  // Active users can be defined as users who have a non-free plan, OR have connected youtube accounts recently. Let's just track connected ones.
  const activeUsers = await User.countDocuments({ isYoutubeConnected: true });

  const totalJobs = await Job.countDocuments();
  const successfulJobs = await Job.countDocuments({ status: 'success' });
  const failedJobs = await Job.countDocuments({ status: 'failed' });

  const successRate = totalJobs > 0 ? ((successfulJobs / totalJobs) * 100).toFixed(2) + '%' : '0%';
  const failureRate = totalJobs > 0 ? ((failedJobs / totalJobs) * 100).toFixed(2) + '%' : '0%';

  // Placeholder calculation
  const totalEarnings = totalActiveSubscriptions * 10;

  res.status(200).json({
    success: true,
    data: {
      totalUsers,
      activeUsers,
      totalActiveSubscriptions,
      totalEarnings,
      jobs: {
        total: totalJobs,
        successful: successfulJobs,
        failed: failedJobs,
        successRate,
        failureRate
      }
    },
  });
});

export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await User.find({}).select('email plan uploadsUsedToday uploadsOnHold subscriptionExpiresAt').sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: users,
  });
});

export const getUserDetails = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await User.findById(id).select('-password');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const jobs = await Job.find({ userId: id as string }).sort({ createdAt: -1 });
  const prompts = await Prompt.find({ userId: id as string }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: {
      user,
      jobs,
      prompts,
    },
  });
});

const updateUserPlanSchema = z.object({
  body: z.object({
    plan: z.enum(['free', 'basic', 'pro', 'premium'], {
      message: "plan must be 'free', 'basic', 'pro', or 'premium'",
    }),
    subscriptionExpiresAt: z.string().optional().nullable(),
  }),
});

export const updateUserPlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const validation = updateUserPlanSchema.safeParse({ body: req.body });

  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { plan, subscriptionExpiresAt } = validation.data.body;

  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  user.plan = plan;

  if (subscriptionExpiresAt) {
    user.subscriptionExpiresAt = new Date(subscriptionExpiresAt);
    user.subscriptionStatus = 'active'; // Assuming setting a date makes it active
  } else if (subscriptionExpiresAt === null) {
    user.set('subscriptionExpiresAt', undefined);
    user.subscriptionStatus = plan === 'free' ? 'inactive' : 'active';
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: 'User plan updated successfully',
    data: {
      _id: user.id,
      email: user.email,
      plan: user.plan,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      subscriptionStatus: user.subscriptionStatus,
    },
  });
});
