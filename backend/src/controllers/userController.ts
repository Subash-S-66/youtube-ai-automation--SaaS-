import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import User from '../models/User';
import { z } from 'zod';

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
