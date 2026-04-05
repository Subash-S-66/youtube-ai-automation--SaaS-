import mongoose from 'mongoose';
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
  planLimits?: {
    max_channels?: number;
    daily_upload_limit?: number;
    max_media_items?: number;
    max_video_items?: number;
    max_image_items?: number;
    max_thumbnail_items?: number;
    max_clip_length_seconds?: number;
    max_total_video_duration_seconds?: number;
  };
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

const IST_OFFSET_MINUTES = 5 * 60 + 30;

const normalizeRequestedCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
};

export const getCurrentUsageDayStartUtc = (referenceDate: Date = new Date()): Date => {
  const shiftedToIst = new Date(referenceDate.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const shiftedDayStartUtcMs = Date.UTC(
    shiftedToIst.getUTCFullYear(),
    shiftedToIst.getUTCMonth(),
    shiftedToIst.getUTCDate()
  );
  return new Date(shiftedDayStartUtcMs - IST_OFFSET_MINUTES * 60 * 1000);
};

const getChannelLimitWindowStart = (hours: number): Date => {
  const mode = String(process.env.CHANNEL_UPLOAD_LIMIT_MODE || 'ist-day').trim().toLowerCase();
  if (mode === 'rolling-24h') {
    const lookbackHours = Number.isFinite(Number(hours)) ? Math.max(1, Math.floor(Number(hours))) : 24;
    return new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  }
  return getCurrentUsageDayStartUtc();
};

const resolveActiveJobChannelId = (job: Record<string, any>): string => {
  const candidates = [
    job.channelId,
    job.pipelineConfig?.channelId,
    job.youtubeAccountId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return '';
};

const getActiveHoldSummary = async (userId: string): Promise<{ totalOnHold: number; perChannel: Map<string, number> }> => {
  const perChannel = new Map<string, number>();
  let totalOnHold = 0;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { totalOnHold, perChannel };
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const activeJobs = await Job.find({
    userId: userObjectId,
    status: { $in: ['pending', 'processing'] },
  })
    .select('videoCount channelId pipelineConfig youtubeAccountId')
    .lean();

  for (const activeJob of activeJobs) {
    const requestedCount = normalizeRequestedCount((activeJob as any).videoCount);
    totalOnHold += requestedCount;

    const channelId = resolveActiveJobChannelId(activeJob as Record<string, any>);
    if (!channelId) {
      continue;
    }
    perChannel.set(channelId, (perChannel.get(channelId) || 0) + requestedCount);
  }

  return { totalOnHold, perChannel };
};

export const reconcileUserHoldCounters = async (userId: string): Promise<number> => {
  const [summary, user] = await Promise.all([
    getActiveHoldSummary(userId),
    User.findById(userId)
      .select('uploadsOnHold youtubeChannels.channelId youtubeChannels.videosOnHold')
      .lean(),
  ]);

  if (!user) {
    return 0;
  }

  const updates: Promise<any>[] = [];
  const currentUploadsOnHold = Math.max(0, Math.floor(Number((user as any).uploadsOnHold || 0)));
  if (currentUploadsOnHold !== summary.totalOnHold) {
    updates.push(
      User.updateOne(
        { _id: userId },
        {
          $set: {
            uploadsOnHold: summary.totalOnHold,
          },
        }
      )
    );
  }

  const channels = Array.isArray((user as any).youtubeChannels) ? (user as any).youtubeChannels : [];
  for (const channel of channels) {
    const channelId = String(channel?.channelId || '').trim();
    if (!channelId) {
      continue;
    }

    const expectedHold = summary.perChannel.get(channelId) || 0;
    const currentHold = Math.max(0, Math.floor(Number(channel?.videosOnHold || 0)));
    if (currentHold === expectedHold) {
      continue;
    }

    updates.push(
      User.updateOne(
        { _id: userId, 'youtubeChannels.channelId': channelId },
        {
          $set: {
            'youtubeChannels.$.videosOnHold': expectedHold,
          },
        }
      )
    );
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return summary.totalOnHold;
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

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return 0;
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const since = getChannelLimitWindowStart(hours);

  const aggregation = await Job.aggregate<{ totalConsumed: number }>([
    {
      $match: {
        userId: userObjectId,
        channelId: normalizedChannelId,
        status: { $in: ['success', 'failed'] },
        holdConsumed: true,
        completedAt: { $gte: since },
      },
    },
    {
      $project: {
        _id: 0,
        requestedCount: {
          $max: [1, { $floor: { $ifNull: ['$videoCount', 1] } }],
        },
        processedRaw: { $ifNull: ['$processedVideos', 0] },
      },
    },
    {
      $project: {
        resolvedConsumed: {
          $cond: [
            { $gt: ['$processedRaw', 0] },
            {
              $max: [
                1,
                {
                  $min: ['$requestedCount', { $floor: '$processedRaw' }],
                },
              ],
            },
            '$requestedCount',
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        totalConsumed: { $sum: '$resolvedConsumed' },
      },
    },
  ]);

  return Number(aggregation?.[0]?.totalConsumed || 0);
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

  const startOfUsageDay = getCurrentUsageDayStartUtc();

  // Atomic Lazy Reset
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { lastUploadReset: { $lt: startOfUsageDay } },
        { lastUploadReset: { $exists: false } }
      ]
    },
    {
      $set: {
        uploadsUsedToday: 0,
        lastUploadReset: startOfUsageDay
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

  const uploadsUsedToday = Math.max(0, Math.floor(Number(finalUser.uploadsUsedToday || 0)));
  let uploadsOnHold = Math.max(0, Math.floor(Number(finalUser.uploadsOnHold || 0)));

  try {
    uploadsOnHold = await reconcileUserHoldCounters(userId);
  } catch (error) {
    console.warn('[UploadLimitService] Failed to reconcile hold counters:', error);
  }

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
    planLimits: planObj?.limits || {},
    features: planObj?.features || {},
  };
};

export const reserveCredits = async (userId: string, count: number = 1): Promise<boolean> => {
  const reservationCount = normalizeRequestedCount(count);
  const startOfUsageDay = getCurrentUsageDayStartUtc();

  // 1. Force a lazy reset check first so that we don't accidentally check limits against yesterday's values
  await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { lastUploadReset: { $lt: startOfUsageDay } },
        { lastUploadReset: { $exists: false } }
      ]
    },
    {
      $set: {
        uploadsUsedToday: 0,
        lastUploadReset: startOfUsageDay
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
        $lte: [{ $add: ["$uploadsUsedToday", "$uploadsOnHold", reservationCount] }, maxLimit]
      }
    },
    {
      $inc: { uploadsOnHold: reservationCount }
    },
    { returnDocument: 'after' }
  );

  return !!result;
};

export const consumeReservedCredits = async (userId: string, count: number = 1): Promise<boolean> => {
  const consumeCount = normalizeRequestedCount(count);

  const strictResult = await User.findOneAndUpdate(
    { _id: userId, uploadsOnHold: { $gte: consumeCount } },
    {
      $inc: {
        uploadsUsedToday: consumeCount,
        uploadsOnHold: -consumeCount
      }
    },
    { returnDocument: 'after' }
  );

  if (strictResult) {
    return true;
  }

  const user = await User.findById(userId).select('uploadsOnHold').lean();
  const availableOnHold = Math.max(0, Math.floor(Number((user as any)?.uploadsOnHold || 0)));
  if (availableOnHold <= 0) {
    return false;
  }

  const fallbackResult = await User.findOneAndUpdate(
    { _id: userId, uploadsOnHold: { $gte: availableOnHold } },
    {
      $inc: {
        uploadsUsedToday: availableOnHold,
        uploadsOnHold: -availableOnHold,
      },
    },
    { returnDocument: 'after' }
  );

  return !!fallbackResult;
};

export const releaseReservedCredits = async (userId: string, count: number = 1): Promise<boolean> => {
  const releaseCount = normalizeRequestedCount(count);

  const strictResult = await User.findOneAndUpdate(
    { _id: userId, uploadsOnHold: { $gte: releaseCount } },
    {
      $inc: {
        uploadsOnHold: -releaseCount
      }
    },
    { returnDocument: 'after' }
  );

  if (strictResult) {
    return true;
  }

  const fallbackResult = await User.findOneAndUpdate(
    { _id: userId, uploadsOnHold: { $gt: 0 } },
    {
      $set: {
        uploadsOnHold: 0,
      },
    },
    { returnDocument: 'after' }
  );

  return !!fallbackResult;
};

export const incrementUploadCount = async (userId: string, count: number = 1): Promise<void> => {
  const incrementCount = normalizeRequestedCount(count);
  const startOfUsageDay = getCurrentUsageDayStartUtc();

  // Atomically lazy-reset AND increment if out of date, or just increment if up to date
  const result = await User.findOneAndUpdate(
    {
      _id: userId,
      lastUploadReset: { $lt: startOfUsageDay }
    },
    {
      $set: {
        uploadsUsedToday: incrementCount,
        lastUploadReset: startOfUsageDay
      }
    }
  );

  if (!result) {
    // Already up to date, just increment
    await User.updateOne(
      { _id: userId },
      { $inc: { uploadsUsedToday: incrementCount } }
    );
  }
};
