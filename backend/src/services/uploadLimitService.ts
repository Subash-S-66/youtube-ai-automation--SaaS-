import User from '../models/User';
import { PlanType } from '../config/plans';
import SystemConfig from '../models/SystemConfig';
import Plan from '../models/Plan';
import Job from '../models/Job';

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

const resolveConsumedCountForJob = (job: {
  holdConsumed?: boolean;
  videoCount?: number;
  processedVideos?: number;
}): number => {
  if (!job?.holdConsumed) {
    return 0;
  }

  const requestedCount = Math.max(1, Math.floor(Number(job.videoCount || 1)));
  const processedCountRaw = Number(job.processedVideos);
  if (Number.isFinite(processedCountRaw) && processedCountRaw > 0) {
    return Math.max(1, Math.min(requestedCount, Math.floor(processedCountRaw)));
  }
  return requestedCount;
};

export const getConsumedUploadsLast24hForChannel = async (
  userId: string,
  channelId: string,
  hours: number = 24
): Promise<number> => {
  const normalizedChannelId = String(channelId || '').trim();
  if (!normalizedChannelId) {
    return 0;
  }

  const lookbackHours = Number.isFinite(Number(hours)) ? Math.max(1, Math.floor(Number(hours))) : 24;
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const recentSettledJobs = await Job.find({
    userId,
    channelId: normalizedChannelId,
    status: { $in: ['success', 'failed'] },
    holdConsumed: true,
    completedAt: { $gte: since },
  }).select('holdConsumed videoCount processedVideos');

  return recentSettledJobs.reduce((sum, job) => {
    return sum + resolveConsumedCountForJob({
      holdConsumed: Boolean((job as any).holdConsumed),
      videoCount: Number((job as any).videoCount || 1),
      processedVideos: Number((job as any).processedVideos || 0),
    });
  }, 0);
};

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
  // Always use the most recent config in case multiple records exist.
  const systemConfig = await SystemConfig.findOne().sort({ updatedAt: -1 });

  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Atomic Lazy Reset
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { lastUploadReset: { $lt: startOfUTCDay } },
        { lastUploadReset: { $exists: false } }
      ]
    },
    {
      $set: {
        uploadsUsedToday: 0,
        lastUploadReset: startOfUTCDay
      }
    },
    { returnDocument: 'after' } // Returns the document AFTER update
  );

  // If no reset was needed, fetch the user normally
  const user = updatedUser || await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const finalUser = await checkAndDowngradeExpiredPlan(user);

  let uploadsUsedToday = finalUser.uploadsUsedToday || 0;
  let uploadsOnHold = finalUser.uploadsOnHold || 0;

  const actualPlanName = finalUser.plan as string;
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

export const reserveCredits = async (userId: string, count: number = 1): Promise<boolean> => {
  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // 1. Force a lazy reset check first so that we don't accidentally check limits against yesterday's values
  await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { lastUploadReset: { $lt: startOfUTCDay } },
        { lastUploadReset: { $exists: false } }
      ]
    },
    {
      $set: {
        uploadsUsedToday: 0,
        lastUploadReset: startOfUTCDay
      }
    }
  );

  // Determine user's effective limit to reserve
  const limits = await getUploadLimits(userId);
  const maxLimit = limits.dailyLimit;

  // 2. Atomic reservation: Only increment if (uploadsUsedToday + uploadsOnHold + count) <= dailyLimit
  const result = await User.findOneAndUpdate(
    {
      _id: userId,
      $expr: {
        $lte: [{ $add: ["$uploadsUsedToday", "$uploadsOnHold", count] }, maxLimit]
      }
    },
    {
      $inc: { uploadsOnHold: count }
    },
    { returnDocument: 'after' }
  );

  return !!result;
};

export const consumeReservedCredits = async (userId: string, count: number = 1): Promise<boolean> => {
  const result = await User.findOneAndUpdate(
    { _id: userId, uploadsOnHold: { $gte: count } },
    {
      $inc: {
        uploadsUsedToday: count,
        uploadsOnHold: -count
      }
    },
    { returnDocument: 'after' }
  );
  return !!result;
};

export const releaseReservedCredits = async (userId: string, count: number = 1): Promise<boolean> => {
  const result = await User.findOneAndUpdate(
    { _id: userId, uploadsOnHold: { $gte: count } },
    {
      $inc: {
        uploadsOnHold: -count
      }
    },
    { returnDocument: 'after' }
  );
  return !!result;
};

export const incrementUploadCount = async (userId: string, count: number = 1): Promise<void> => {
  const now = new Date();
  const startOfUTCDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Atomically lazy-reset AND increment if out of date, or just increment if up to date
  const result = await User.findOneAndUpdate(
    {
      _id: userId,
      lastUploadReset: { $lt: startOfUTCDay }
    },
    {
      $set: {
        uploadsUsedToday: count,
        lastUploadReset: startOfUTCDay
      }
    }
  );

  if (!result) {
    // Already up to date, just increment
    await User.updateOne(
      { _id: userId },
      { $inc: { uploadsUsedToday: count } }
    );
  }
};
