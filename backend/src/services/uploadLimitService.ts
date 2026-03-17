import User from '../models/User';
import { resetDailyUploads } from '../utils/dailyReset';

interface UploadCheckResult {
  allowed: boolean;
  remainingUploads: number;
  message?: string;
}

export const canUserUpload = async (userId: string): Promise<UploadCheckResult> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  // Define plan rules dynamically if needed, or rely on user model defaults
  if (user.plan === 'free' && user.uploadLimitPerDay !== 3) {
    user.uploadLimitPerDay = 3;
  } else if (user.plan === 'pro' && user.uploadLimitPerDay !== 100) {
    // Arbitrary very high value for pro plan as per instructions
    user.uploadLimitPerDay = 100;
  }

  // Reset daily counter if necessary
  const wasReset = resetDailyUploads(user);
  if (wasReset || user.isModified('uploadLimitPerDay')) {
    await user.save();
  }

  const remainingUploads = user.uploadLimitPerDay - user.uploadsUsedToday;

  if (remainingUploads <= 0) {
    return {
      allowed: false,
      remainingUploads: 0,
      message: 'Daily upload limit reached',
    };
  }

  return {
    allowed: true,
    remainingUploads,
  };
};

export const incrementUploadCount = async (userId: string): Promise<void> => {
  // Use findOneAndUpdate to help ensure atomicity where possible,
  // but we must check for reset first.

  // First fetch the user
  const user = await User.findById(userId);
  if (!user) return;

  // Run the daily reset logic check
  const wasReset = resetDailyUploads(user);

  if (wasReset) {
      // If we just reset, we are effectively setting it to 1
      user.uploadsUsedToday = 1;
      await user.save();
  } else {
      // Otherwise, atomic increment to prevent race conditions during parallel processing
      await User.findByIdAndUpdate(userId, {
          $inc: { uploadsUsedToday: 1 }
      });
  }
};
