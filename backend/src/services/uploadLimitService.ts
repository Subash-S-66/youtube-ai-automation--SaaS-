import User from '../models/User';
import { planLimits, PlanType } from '../config/plans';
import { checkAndUpdateUserPlan } from '../utils/subscriptionHelper';

interface UploadLimitCheckResult {
  canUpload: boolean;
  remainingUploads: number;
  plan: PlanType;
}

export const checkAndDowngradeExpiredPlan = async (user: any): Promise<any> => {
  if (user.subscriptionExpiresAt && new Date() > user.subscriptionExpiresAt) {
    user.plan = 'free';
    user.subscriptionExpiresAt = undefined;
    await user.save();
  }
  return user;
};

export const getUploadLimits = async (userId: string): Promise<UploadLimitCheckResult> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const updatedUser = await checkAndDowngradeExpiredPlan(user);

  // UTC day reset check
  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let uploadsUsedToday = updatedUser.uploadsUsedToday;
  let uploadsOnHold = updatedUser.uploadsOnHold || 0;

  if (updatedUser.lastUploadReset < startOfUTCDay) {
    uploadsUsedToday = 0;
    uploadsOnHold = 0; // Assuming holds don't carry over days, or adjust as needed
    updatedUser.uploadsUsedToday = 0;
    updatedUser.uploadsOnHold = 0;
    updatedUser.lastUploadReset = now;
    await updatedUser.save();
  }

  const limit = planLimits[updatedUser.plan as PlanType] || planLimits.free;
  const remainingUploads = Math.max(0, limit - uploadsUsedToday - uploadsOnHold);

  return {
    canUpload: remainingUploads > 0,
    remainingUploads,
    plan: updatedUser.plan as PlanType,
  };
};

export const incrementUploadCount = async (userId: string): Promise<void> => {
  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      lastUploadReset: { $lt: startOfUTCDay }
    },
    {
      $set: { uploadsUsedToday: 1, uploadsOnHold: 0, lastUploadReset: now }
    },
    { new: true }
  );

  if (!user) {
    await User.updateOne(
      { _id: userId },
      { $inc: { uploadsUsedToday: 1 } }
    );
  }
};
