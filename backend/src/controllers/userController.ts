import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import User from '../models/User';
import DeletedUser from '../models/DeletedUser';
import { z } from 'zod';
import { pipelineQueue } from '../queues/pipelineQueue';

// Stripe disabled. Using Razorpay for payments.

const updateSettingsSchema = z.object({
  body: z.object({
    emailNotificationsEnabled: z.boolean().optional(),
    telegramNotificationsEnabled: z.boolean().optional(),
    pushNotificationsEnabled: z.boolean().optional(),
  }),
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }

  const validation = updateSettingsSchema.safeParse({ body: req.body });

  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { emailNotificationsEnabled, telegramNotificationsEnabled, pushNotificationsEnabled } = validation.data.body;

  const updateFields: any = {};
  if (emailNotificationsEnabled !== undefined) updateFields.emailNotificationsEnabled = emailNotificationsEnabled;
  if (telegramNotificationsEnabled !== undefined) updateFields.telegramNotificationsEnabled = telegramNotificationsEnabled;
  if (pushNotificationsEnabled !== undefined) updateFields.pushNotificationsEnabled = pushNotificationsEnabled;

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true, runValidators: true }
  ).select('-password');

  if (!updatedUser) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    success: true,
    message: 'Settings updated successfully',
    data: updatedUser,
  });
});

export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Stripe disabled. If you need Razorpay cancellation, implement it here.

  // Store in DeletedUsers collection
  await DeletedUser.create({
    email: user.email,
    planHistory: [user.plan],
    usageStats: {
      uploadsUsedTotal: user.uploadsUsedToday, // can add historical later if tracked
    },
    deletedAt: new Date(),
  });

  // Remove pending jobs from BullMQ queue to save resources
  try {
    const activeJobs = await pipelineQueue.getJobs(['waiting', 'delayed']);
    for (const job of activeJobs) {
      if (job.data.userId === userId.toString()) {
        await job.remove();
      }
    }
  } catch (error) {
    console.error('Failed to cleanup BullMQ jobs during account deletion:', error);
  }

  // Delete user from active users
  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Account deleted successfully',
  });
});
