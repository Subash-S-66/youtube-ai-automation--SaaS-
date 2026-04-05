import mongoose from 'mongoose';
import Job from '../models/Job';
import User from '../models/User';
import SystemConfig from '../models/SystemConfig';

export interface JobHistoryLimitByPlan {
  free: number;
  basic: number;
  pro: number;
  premium: number;
}

export const DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN: JobHistoryLimitByPlan = {
  free: 10,
  basic: 50,
  pro: 100,
  premium: 200,
};

export const DEFAULT_JOB_HISTORY_MIN_AGE_DAYS = 7;

const clampInteger = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

export const sanitizeJobHistoryLimitByPlan = (input: unknown): JobHistoryLimitByPlan => {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    free: clampInteger(raw.free, 1, 5000, DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.free),
    basic: clampInteger(raw.basic, 1, 5000, DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.basic),
    pro: clampInteger(raw.pro, 1, 5000, DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.pro),
    premium: clampInteger(raw.premium, 1, 5000, DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.premium),
  };
};

export const sanitizeJobHistoryMinAgeDays = (value: unknown): number => {
  return clampInteger(value, 1, 3650, DEFAULT_JOB_HISTORY_MIN_AGE_DAYS);
};

export const getJobHistoryLimitForPlan = (
  plan: string,
  config?: { jobHistoryLimitByPlan?: unknown },
  fallbackLimit = DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.free
): number => {
  const byPlan = sanitizeJobHistoryLimitByPlan(config?.jobHistoryLimitByPlan);
  const normalizedPlan = String(plan || '').trim().toLowerCase();

  if (normalizedPlan === 'premium') return byPlan.premium;
  if (normalizedPlan === 'pro') return byPlan.pro;
  if (normalizedPlan === 'basic') return byPlan.basic;
  if (normalizedPlan === 'free') return byPlan.free;

  return clampInteger(fallbackLimit, 1, 5000, DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.free);
};

export const getJobHistoryMinAgeDays = (
  config?: { jobHistoryMinAgeDays?: unknown },
  fallbackDays = DEFAULT_JOB_HISTORY_MIN_AGE_DAYS
): number => {
  return sanitizeJobHistoryMinAgeDays(config?.jobHistoryMinAgeDays ?? fallbackDays);
};

export interface JobHistoryRetentionResult {
  plan: string;
  limit: number;
  minAgeDays: number;
  totalCount: number;
  excessCount: number;
  eligibleCount: number;
  deletedCount: number;
}

const defaultResult = (plan = 'free'): JobHistoryRetentionResult => ({
  plan,
  limit: DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.free,
  minAgeDays: DEFAULT_JOB_HISTORY_MIN_AGE_DAYS,
  totalCount: 0,
  excessCount: 0,
  eligibleCount: 0,
  deletedCount: 0,
});

export const applyUserJobHistoryRetention = async (userId: string): Promise<JobHistoryRetentionResult> => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return defaultResult();
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const [user, config] = await Promise.all([
    User.findById(userObjectId).select('plan').lean(),
    SystemConfig.findOne().sort({ updatedAt: -1 }).select('jobHistoryLimitByPlan jobHistoryMinAgeDays').lean(),
  ]);

  const plan = String((user as any)?.plan || 'free').trim().toLowerCase() || 'free';
  const limit = getJobHistoryLimitForPlan(plan, config as any, DEFAULT_JOB_HISTORY_LIMIT_BY_PLAN.free);
  const minAgeDays = getJobHistoryMinAgeDays(config as any, DEFAULT_JOB_HISTORY_MIN_AGE_DAYS);

  const totalCount = await Job.countDocuments({ userId: userObjectId });
  if (totalCount <= limit) {
    return {
      ...defaultResult(plan),
      limit,
      minAgeDays,
      totalCount,
    };
  }

  const excessCount = totalCount - limit;
  const cutoffDate = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);

  const candidates = await Job.find({
    userId: userObjectId,
    status: { $in: ['success', 'failed'] },
    createdAt: { $lt: cutoffDate },
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(excessCount)
    .select('_id')
    .lean();

  const eligibleCount = candidates.length;
  if (eligibleCount === 0) {
    return {
      ...defaultResult(plan),
      limit,
      minAgeDays,
      totalCount,
      excessCount,
      eligibleCount,
      deletedCount: 0,
    };
  }

  const candidateIds = candidates
    .map((candidate: any) => candidate?._id)
    .filter(Boolean);

  if (candidateIds.length === 0) {
    return {
      ...defaultResult(plan),
      limit,
      minAgeDays,
      totalCount,
      excessCount,
      eligibleCount,
      deletedCount: 0,
    };
  }

  const deletionResult = await Job.deleteMany({ _id: { $in: candidateIds } });
  const deletedCount = Number(deletionResult.deletedCount || 0);

  return {
    ...defaultResult(plan),
    limit,
    minAgeDays,
    totalCount,
    excessCount,
    eligibleCount,
    deletedCount,
  };
};
