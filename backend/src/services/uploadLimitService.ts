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
  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // We can do this in a single atomic findOneAndUpdate.
  // We check if lastUploadReset is LESS than the start of the current UTC day.
  // If it is, that means we haven't reset today yet, so we reset to 1 and update lastUploadReset.
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      lastUploadReset: { $lt: startOfUTCDay }
    },
    {
      $set: { uploadsUsedToday: 1, lastUploadReset: now }
    },
    { new: true }
  );

  // If the user wasn't found, it means they ALREADY reset today (lastUploadReset >= startOfUTCDay).
  // In that case, we can safely just $inc.
  if (!user) {
    await User.updateOne(
      { _id: userId },
      { $inc: { uploadsUsedToday: 1 } }
    );
  }
};
