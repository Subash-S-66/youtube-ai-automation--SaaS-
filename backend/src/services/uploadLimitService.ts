import User from '../models/User';
import { resetDailyUploads } from '../utils/dailyReset';
import { PLAN_LIMITS } from '../config/plans';
import { checkAndUpdateUserPlan } from '../utils/subscriptionHelper';

interface UploadCheckResult {
  allowed: boolean;
  remainingUploads: number;
  uploadsOnHold: number;
  plan: string;
  message?: string;
}

export const canUserUpload = async (userId: string): Promise<UploadCheckResult> => {
  let user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  // Ensure user's plan is updated if expired
  user = await checkAndUpdateUserPlan(user);

  // Get current plan limit
  const currentLimit = PLAN_LIMITS[user!.plan] || PLAN_LIMITS['free'] || 3;

  // Reset daily counter if necessary
  const wasReset = resetDailyUploads(user as any);
  if (wasReset) {
    await user!.save();
  }

  const uploadsUsedToday = user!.uploadsUsedToday || 0;
  const uploadsOnHold = user!.uploadsOnHold || 0;

  const remainingUploads = currentLimit - (uploadsUsedToday + uploadsOnHold);

  if (remainingUploads <= 0) {
    return {
      allowed: false,
      remainingUploads: 0,
      uploadsOnHold,
      plan: user!.plan,
      message: 'Daily upload limit reached',
    };
  }

  return {
    allowed: true,
    remainingUploads,
    uploadsOnHold,
    plan: user!.plan,
  };
};

export const incrementUploadCount = async (userId: string, count: number = 1): Promise<void> => {
  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // We can do this in a single atomic findOneAndUpdate.
  // We check if lastUploadReset is LESS than the start of the current UTC day.
  // If it is, that means we haven't reset today yet, so we reset to count and update lastUploadReset.
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      lastUploadReset: { $lt: startOfUTCDay }
    },
    {
      $set: { uploadsUsedToday: count, lastUploadReset: now }
    },
    { new: true }
  );

  // If the user wasn't found, it means they ALREADY reset today (lastUploadReset >= startOfUTCDay).
  // In that case, we can safely just $inc.
  if (!user) {
    await User.updateOne(
      { _id: userId },
      { $inc: { uploadsUsedToday: count } }
    );
  }
};
