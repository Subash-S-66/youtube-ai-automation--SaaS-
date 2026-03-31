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
    templateFont: z.string().optional(),
    templateColor: z.string().optional(),
    lastInputMode: z.enum(['topic', 'prompt']).optional(),
    lastPrompt: z.string().optional(),
    lastSelectedTopic: z.string().optional(),
    lastCustomTopic: z.string().optional(),
    lastChannelInputs: z.record(
      z.string(),
      z.object({
        inputMode: z.enum(['topic', 'prompt']).optional(),
        prompt: z.string().optional(),
        selectedTopic: z.string().optional(),
        customTopic: z.string().optional(),
        storyMode: z.boolean().optional(),
        storyId: z.string().optional(),
        currentPart: z.number().int().min(1).optional(),
        storyContext: z.string().optional(),
        recapEnabled: z.boolean().optional(),
        ctaEnabled: z.boolean().optional(),
        duration: z.number().int().min(15).max(120).optional(),
        contentType: z.enum(['clips', 'images', 'mixed']).optional(),
        videoCount: z.number().int().min(1).max(10).optional(),
        selectedVoices: z.array(z.string()).optional(),
        randomVoice: z.boolean().optional(),
        templateFont: z.string().optional(),
        templateColor: z.string().optional(),
        captionPosition: z.enum(['top', 'middle', 'bottom']).optional(),
        maxWordsPerCaption: z.number().int().min(1).max(8).optional(),
        useCustomMedia: z.boolean().optional(),
        selectedThumbnailId: z.string().optional(),
        scheduleEnabled: z.boolean().optional(),
        scheduleDatetime: z.string().optional(),
        autoUploadEnabled: z.boolean().optional(),
        autoUploadIntervalHours: z.number().int().min(1).max(24).optional(),
        autoUploadVideosPerInterval: z.number().int().min(1).max(10).optional(),
      })
    ).optional(),
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

  const { emailNotificationsEnabled, telegramNotificationsEnabled, pushNotificationsEnabled, templateFont, templateColor, lastInputMode, lastPrompt, lastSelectedTopic, lastCustomTopic, lastChannelInputs } = validation.data.body;

  const updateFields: any = {};
  if (emailNotificationsEnabled !== undefined) updateFields.emailNotificationsEnabled = emailNotificationsEnabled;
  if (telegramNotificationsEnabled !== undefined) updateFields.telegramNotificationsEnabled = telegramNotificationsEnabled;
  if (pushNotificationsEnabled !== undefined) updateFields.pushNotificationsEnabled = pushNotificationsEnabled;
  if (templateFont !== undefined) updateFields.templateFont = templateFont;
  if (templateColor !== undefined) updateFields.templateColor = templateColor;
  if (lastInputMode !== undefined) updateFields.lastInputMode = lastInputMode;
  if (lastPrompt !== undefined) updateFields.lastPrompt = lastPrompt;
  if (lastSelectedTopic !== undefined) updateFields.lastSelectedTopic = lastSelectedTopic;
  if (lastCustomTopic !== undefined) updateFields.lastCustomTopic = lastCustomTopic;
  if (lastChannelInputs !== undefined) updateFields.lastChannelInputs = lastChannelInputs;

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { returnDocument: 'after', runValidators: true }
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
