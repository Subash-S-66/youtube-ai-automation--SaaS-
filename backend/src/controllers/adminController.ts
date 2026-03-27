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
import { emailQueue } from '../queues/emailQueue';
import { pipelineQueue } from '../queues/pipelineQueue';

// Stripe disabled. Using Razorpay for payments.

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
      .max(200, 'Banner message must be at most 200 characters')
      .refine(s => !s.includes('\n'), { message: 'Banner message must be a single line (no newlines)' })
      .optional(),
    isActive: z.boolean().default(true),
    type: z.enum([
      'info-blue',
      'info-cyan',
      'info-green',
      'info-purple',
      'warning-amber',
      'warning-gold',
      'critical-red',
      'critical-rose',
    ]).default('info-blue'),
    startAt: z.string().optional().nullable(),
    endAt: z.string().optional().nullable(),
  }),
});

export const getSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  let config = await SystemConfig.findOne().sort({ updatedAt: -1 });
  if (!config) {
    config = await SystemConfig.create({ betaMode: false, pipelineRunner: 'local' });
  } else {
    // Ensure only one config doc exists.
    await SystemConfig.deleteMany({ _id: { $ne: config._id } });
  }

  res.status(200).json({
    success: true,
    data: config,
  });
});

const configSchema = z.object({
  body: z.object({
    betaMode: z.boolean(),
    pipelineRunner: z.enum(['local', 'azure']).optional(),
    planValueMap: z
      .object({
        free: z.number(),
        basic: z.number(),
        pro: z.number(),
        premium: z.number(),
      })
      .optional(),
  }),
});

export const updateSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  const validation = configSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { betaMode, planValueMap } = validation.data.body;
  const updatePayload: any = { betaMode };
  if (validation.data.body.pipelineRunner) {
    updatePayload.pipelineRunner = validation.data.body.pipelineRunner;
  }
  if (planValueMap) {
    updatePayload.planValueMap = planValueMap;
  }
  const config = await SystemConfig.findOneAndUpdate(
    {},
    updatePayload,
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );
  // Cleanup any stale duplicates.
  await SystemConfig.deleteMany({ _id: { $ne: config._id } });

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
  const normalizedMessage = (message || '').trim();

  if (isActive && normalizedMessage.length === 0) {
    throw new AppError('Banner message is required', 400);
  }

  if (banner) {
    if (normalizedMessage.length > 0) {
      banner.message = normalizedMessage;
    }
    banner.isActive = isActive;
    banner.type = type;
    banner.startAt = startAt ? new Date(startAt) : null as any;
    banner.endAt = endAt ? new Date(endAt) : null as any;
    await banner.save();
  } else {
    if (isActive && normalizedMessage.length === 0) {
      throw new AppError('Banner message is required when creating a new banner', 400);
    }
    banner = await GlobalBanner.create({
      // Allow creating an inactive banner record even if message is blank.
      message: normalizedMessage.length > 0 ? normalizedMessage : '   ',
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

export const getGlobalBannerConfig = asyncHandler(async (req: Request, res: Response) => {
  const banner = await GlobalBanner.findOne();
  res.status(200).json({
    success: true,
    data: banner || null,
  });
});

export const deleteUserByAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Stripe disabled. If you need Razorpay cancellation, implement it here.

  // Store in DeletedUsers collection
  await DeletedUser.create({
    email: user.email,
    planHistory: [user.plan],
    usageStats: {
      uploadsUsedTotal: user.uploadsUsedToday,
    },
    deletedAt: new Date(),
  });

  // Remove pending jobs from BullMQ queue to save resources
  try {
    const activeJobs = await pipelineQueue.getJobs(['waiting', 'delayed']);
    for (const job of activeJobs) {
      if (id && job.data.userId === id.toString()) {
        await job.remove();
      }
    }
  } catch (error) {
    console.error('Failed to cleanup BullMQ jobs during admin deletion:', error);
  }

  // Delete user from active users
  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
  });
});

export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const search = req.query.search as string;
  const cursor = req.query.cursor as string;

  const query: any = {};
  if (search && typeof search === 'string') {
    // Escape regex to prevent ReDoS
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.email = { $regex: escapedSearch, $options: 'i' };
  }
  if (cursor) {
    query._id = { $lt: cursor };
  }

  const users = await User.find(query)
    .select('email plan uploadsUsedToday uploadsOnHold subscriptionExpiresAt createdAt')
    .sort({ _id: -1 })
    .limit(limit + 1);

  let nextCursor = null;
  if (users.length > limit) {
    const nextUser = users.pop();
    nextCursor = nextUser?._id;
  }

  const total = await User.countDocuments(query);

  res.status(200).json({
    success: true,
    data: users,
    pagination: {
      total,
      limit,
      nextCursor,
    },
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

export const getPlans = asyncHandler(async (req: Request, res: Response) => {
  const Plan = require('../models/Plan').default;
  const plans = await Plan.find();
  res.status(200).json({
    success: true,
    data: plans,
  });
});

export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const Plan = require('../models/Plan').default;
  const plan = await Plan.findByIdAndUpdate(id, req.body, { returnDocument: 'after', runValidators: true });

  if (!plan) {
    throw new AppError('Plan not found', 404);
  }

  res.status(200).json({
    success: true,
    message: 'Plan updated successfully',
    data: plan,
  });
});

export const triggerWeeklyReports = asyncHandler(async (req: Request, res: Response) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const activeUsers = await User.find({
    plan: { $in: ['basic', 'pro', 'premium'] }
  }).select('email _id');

  let emailsQueued = 0;

  for (const user of activeUsers) {
    const weeklyJobs = await Job.countDocuments({
      userId: user._id,
      status: 'success',
      createdAt: { $gte: oneWeekAgo }
    });

    if (weeklyJobs > 0) {
      await emailQueue.add('emailJob', {
        to: user.email,
        subject: 'Your Weekly ClipForge Analytics',
        message: `Hello!

You successfully generated and uploaded ${weeklyJobs} videos over the past 7 days. Keep up the great work and watch your channels grow!

- The ClipForge Team`
      });
      emailsQueued++;
    }
  }

  res.status(200).json({
    success: true,
    message: `Weekly report triggered successfully. Queued ${emailsQueued} emails.`,
  });
});
