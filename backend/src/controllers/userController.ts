import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import User from '../models/User';
import DeletedUser from '../models/DeletedUser';
import { z } from 'zod';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-01-27.acacia' as any,
});

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
      console.error('Failed to cancel Stripe subscription during account deletion:', error);
    }
  }

  // Store in DeletedUsers collection
  await DeletedUser.create({
    email: user.email,
    planHistory: [user.plan],
    usageStats: {
      uploadsUsedTotal: user.uploadsUsedToday, // can add historical later if tracked
    },
    deletedAt: new Date(),
  });

  // Delete user from active users
  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Account deleted successfully',
  });
});
