import User from '../models/User';
import { PlanType } from '../config/plans';
import SystemConfig from '../models/SystemConfig';
import Plan from '../models/Plan';

interface UploadLimitCheckResult {
  canUpload: boolean;
  remainingUploads: number;
  dailyLimit: number;
  plan: string;
  displayPlan?: string;
  isBetaMode?: boolean;
  features?: {
    voice_selection?: boolean;
    scheduling?: boolean;
    multi_channel?: boolean;
    story_mode?: boolean;
    cta?: boolean;
    format_selection?: boolean;
    template_customization?: boolean;
    custom_media?: boolean;
  };
}

export const checkAndDowngradeExpiredPlan = async (user: any): Promise<any> => {
  if (user.subscriptionExpiresAt && new Date() > user.subscriptionExpiresAt) {
    user.plan = 'free';
    user.subscriptionExpiresAt = undefined;

    // Disable excess channels logic
    const freePlan = await Plan.findOne({ name: 'free' });
    const maxChannels = freePlan ? freePlan.limits.max_channels : 1;

    if (user.youtubeChannels && user.youtubeChannels.length > maxChannels) {
      user.youtubeChannels.forEach((ch: any) => {
          if (!ch.status) ch.status = 'active'; // ensure old ones have a status
      });

      let activeChannels = user.youtubeChannels.filter((c: any) => c.status !== 'disabled_due_to_plan');

      // Sort by recently warned/used if available, or fallback to createdAt
      activeChannels.sort((a: any, b: any) => {
        const timeA = a.lastLimitWarningSentAt ? new Date(a.lastLimitWarningSentAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.lastLimitWarningSentAt ? new Date(b.lastLimitWarningSentAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeB - timeA; // Descending, so newest/most active first
      });

      if (activeChannels.length > maxChannels) {
         for (let i = maxChannels; i < activeChannels.length; i++) {
             // Disable the ones beyond the allowed limit
             const channelToDisable = activeChannels[i];
             const idx = user.youtubeChannels.findIndex((c: any) => c.channelId === channelToDisable.channelId);
             if (idx !== -1) {
               user.youtubeChannels[idx].status = 'disabled_due_to_plan';
             }
         }
      }
    }

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

  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // The actual DB reset now happens in the daily cron job `dailyResetCron.ts`
  // which acts as the single source of truth. We use the saved values exclusively
  // to avoid in-memory state desync or race conditions.
  let uploadsUsedToday = updatedUser.uploadsUsedToday;
  let uploadsOnHold = updatedUser.uploadsOnHold || 0;

  const actualPlanName = updatedUser.plan as string;
  const betaForFreeUsers = !!systemConfig?.betaMode && actualPlanName === 'free';
  const effectivePlanName = betaForFreeUsers ? 'basic' : actualPlanName;

  const planObj = await Plan.findOne({ name: effectivePlanName }) || await Plan.findOne({ name: 'free' });
  const dailyLimit = planObj ? planObj.limits.daily_upload_limit : 2;

  const remainingUploads = Math.max(0, dailyLimit - uploadsUsedToday - uploadsOnHold);

  return {
    canUpload: remainingUploads > 0,
    remainingUploads,
    dailyLimit,
    // Plan is the effective plan used for feature gating and limits.
    plan: effectivePlanName,
    // Keep display label explicit so UI can show real plan with beta override.
    displayPlan: betaForFreeUsers ? 'free (beta basic)' : actualPlanName,
    isBetaMode: betaForFreeUsers,
    features: planObj?.features || {},
  };
};

export const incrementUploadCount = async (userId: string, count: number = 1): Promise<void> => {
  // Reset logic is now handled by daily cron. Just increment.
  await User.updateOne(
    { _id: userId },
    { $inc: { uploadsUsedToday: count } }
  );
};
