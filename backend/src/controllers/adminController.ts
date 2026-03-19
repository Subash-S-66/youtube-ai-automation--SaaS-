import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import User from '../models/User';
import Job from '../models/Job';
import Prompt from '../models/Prompt';
import Notification from '../models/Notification';
import GlobalBanner from '../models/GlobalBanner';
import DeletedUser from '../models/DeletedUser';
import SystemConfig from '../models/SystemConfig';
import { z } from 'zod';
import { PLAN_LIMITS } from '../config/plans';
import { emailQueue } from '../queues/emailQueue';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-01-27.acacia' as any,
});

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

const notificationSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required'),
    message: z.string().min(1, 'Message is required'),
    type: z.enum(['info', 'warning', 'critical']).default('info'),
    targetPlans: z.array(z.enum(['free', 'basic', 'pro', 'premium'])).nonempty('At least one plan must be selected'),
    sendEmail: z.boolean().default(false),
  }),
});

export const createNotification = asyncHandler(async (req: Request, res: Response) => {
  const validation = notificationSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { title, message, type, targetPlans, sendEmail } = validation.data.body;

  const notification = await Notification.create({
    title,
    message,
    type,
    targetPlans,
    sendEmail,
  });

  if (sendEmail) {
    const usersToEmail = await User.find({ plan: { $in: targetPlans } }).select('email');
    const emailJobs = usersToEmail.map(user => ({
      name: 'emailJob',
      data: {
        to: user.email,
        subject: title,
        message,
      },
    }));

    if (emailJobs.length > 0) {
      await emailQueue.addBulk(emailJobs);
    }
  }

  res.status(201).json({
    success: true,
    message: 'Notification created successfully',
    data: notification,
  });
});

const bannerSchema = z.object({
  body: z.object({
    message: z.string()
      .min(1, 'Banner message is required')
      .max(200, 'Banner message must be at most 200 characters')
      .refine(s => !s.includes('\n'), { message: 'Banner message must be a single line (no newlines)' }),
    isActive: z.boolean().default(true),
    type: z.enum(['info', 'warning', 'critical']).default('info'),
    startAt: z.string().optional().nullable(),
    endAt: z.string().optional().nullable(),
  }),
});

export const getSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  let config = await SystemConfig.findOne();
  if (!config) {
    config = await SystemConfig.create({ betaMode: false });
  }

  res.status(200).json({
    success: true,
    data: config,
  });
});

const configSchema = z.object({
  body: z.object({
    betaMode: z.boolean(),
  }),
});

export const updateSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  const validation = configSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { betaMode } = validation.data.body;

  let config = await SystemConfig.findOne();
  if (config) {
    config.betaMode = betaMode;
    await config.save();
  } else {
    config = await SystemConfig.create({ betaMode });
  }

  res.status(200).json({
    success: true,
    message: 'System config updated successfully',
    data: config,
  });
});

export const setGlobalBanner = asyncHandler(async (req: Request, res: Response) => {
  const validation = bannerSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { message, isActive, type, startAt, endAt } = validation.data.body;

  let banner = await GlobalBanner.findOne();

  if (banner) {
    banner.message = message;
    banner.isActive = isActive;
    banner.type = type;
    banner.startAt = startAt ? new Date(startAt) : null as any;
    banner.endAt = endAt ? new Date(endAt) : null as any;
    await banner.save();
  } else {
    banner = await GlobalBanner.create({
      message,
      isActive,
      type,
      startAt: startAt ? new Date(startAt) : null as any,
      endAt: endAt ? new Date(endAt) : null as any,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Global banner updated successfully',
    data: banner,
  });
});

export const deleteUserByAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Cancel Stripe subscription
  if (user.stripeCustomerId && user.subscriptionStatus === 'active') {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: 'active',
      });
      for (const sub of subscriptions.data) {
        await stripe.subscriptions.cancel(sub.id);
      }
    } catch (error) {
      console.error('Failed to cancel Stripe subscription during admin deletion:', error);
    }
  }

  // Store in DeletedUsers collection
  await DeletedUser.create({
    email: user.email,
    planHistory: [user.plan],
    usageStats: {
      uploadsUsedTotal: user.uploadsUsedToday,
    },
    deletedAt: new Date(),
  });

  // Delete user from active users
  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
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
