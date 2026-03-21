import User from '../models/User';
import { PlanType, resolvePlanLimit } from '../config/plans';
import SystemConfig from '../models/SystemConfig';

interface UploadLimitCheckResult {
  canUpload: boolean;
  remainingUploads: number;
  dailyLimit: number;
  plan: PlanType;
  displayPlan?: string;
  isBetaMode?: boolean;
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
  // Always use the most recent config in case multiple records exist.
  const systemConfig = await SystemConfig.findOne().sort({ updatedAt: -1 });

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

  const actualPlan = updatedUser.plan as PlanType;
  const betaForFreeUsers = !!systemConfig?.betaMode && actualPlan === 'free';
  const effectivePlan: PlanType = betaForFreeUsers ? 'basic' : actualPlan;

  const dailyLimit = resolvePlanLimit(effectivePlan, systemConfig?.planLimits);
  const remainingUploads = Math.max(0, dailyLimit - uploadsUsedToday - uploadsOnHold);

  return {
    canUpload: remainingUploads > 0,
    remainingUploads,
    dailyLimit,
    // Plan is the effective plan used for feature gating and limits.
    plan: effectivePlan,
    // Keep display label explicit so UI can show real plan with beta override.
    displayPlan: betaForFreeUsers ? 'free (beta basic)' : actualPlan,
    isBetaMode: betaForFreeUsers,
  };
};

export const incrementUploadCount = async (userId: string, count: number = 1): Promise<void> => {
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
      { $inc: { uploadsUsedToday: count } }
    );
  }
};
