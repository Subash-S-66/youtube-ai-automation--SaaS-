import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import User from '../models/User';
import Job from '../models/Job';
import Prompt from '../models/Prompt';
import Notification from '../models/Notification';
import GlobalBanner from '../models/GlobalBanner';
import DeletedUser from '../models/DeletedUser';
import SystemConfig from '../models/SystemConfig';
import Plan from '../models/Plan';
import { z } from 'zod';
import validator from 'validator';
import { emailQueue } from '../queues/emailQueue';
import { pipelineQueue } from '../queues/pipelineQueue';
import {
  sanitizePipelineRetriesByPlan,
  sanitizePipelineRunnerFallbackOrder,
} from '../services/pipelineRetryPolicyService';
import { sanitizePipelineConcurrencyByPlan } from '../services/pipelineConcurrencyPolicyService';
import {
  applyUserJobHistoryRetention,
  sanitizeJobHistoryLimitByPlan,
  sanitizeJobHistoryMinAgeDays,
} from '../services/jobHistoryRetentionPolicyService';
import { getUploadLimits } from '../services/uploadLimitService';
import { connection } from '../config/redis';
import { resolveLocalPythonRuntime } from '../workers/localPipelineTrigger';

// Stripe disabled. Using Razorpay for payments.

const SUPPORTED_PLANS = ['free', 'basic', 'pro', 'premium'] as const;
const STAFF_ROLES = ['admin', 'helper'] as const;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MINUTES = 100;
const DEFAULT_PROCESSING_HARD_TIMEOUT_MINUTES = 100;
const SUPPORTED_PIPELINE_RUNNERS = ['local', 'azure', 'remote'] as const;
const SUPPORTED_PIPELINE_WORKER_PROFILES = ['local', 'vm', 'cloud'] as const;
const SUPPORTED_WORKER_HEARTBEAT_SOURCES = ['dedicated', 'embedded'] as const;

type PipelineRunnerType = (typeof SUPPORTED_PIPELINE_RUNNERS)[number];
type PipelineWorkerProfileType = (typeof SUPPORTED_PIPELINE_WORKER_PROFILES)[number];
type WorkerHeartbeatSourceType = (typeof SUPPORTED_WORKER_HEARTBEAT_SOURCES)[number];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const generateReferralCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const parseBooleanEnv = (value: unknown, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
};

const normalizePipelineRunner = (value: unknown): PipelineRunnerType | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'azure' || normalized === 'remote') {
    return normalized;
  }
  return null;
};

const normalizePipelineWorkerProfile = (value: unknown): PipelineWorkerProfileType => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'vm') {
    return 'vm';
  }
  if (normalized === 'cloud') {
    return 'cloud';
  }
  return 'local';
};

const normalizePipelineWorkerConcurrency = (value: unknown): number | null => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(1, Math.min(32, Math.floor(parsed)));
};

const normalizeWorkerHeartbeatSource = (value: unknown): WorkerHeartbeatSourceType => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'embedded') {
    return 'embedded';
  }
  return 'dedicated';
};

const getMissingAzureRunnerEnv = (): string[] => {
  const missing: string[] = [];
  if (!String(process.env.AZURE_JOB_NAME || '').trim()) {
    missing.push('AZURE_JOB_NAME');
  }
  if (!String(process.env.AZURE_RESOURCE_GROUP || process.env.RESOURCE_GROUP || '').trim()) {
    missing.push('AZURE_RESOURCE_GROUP|RESOURCE_GROUP');
  }
  if (!String(process.env.AZURE_SUBSCRIPTION_ID || '').trim()) {
    missing.push('AZURE_SUBSCRIPTION_ID');
  }
  if (!String(process.env.AZURE_TENANT_ID || '').trim()) {
    missing.push('AZURE_TENANT_ID');
  }
  if (!String(process.env.AZURE_CLIENT_ID || '').trim()) {
    missing.push('AZURE_CLIENT_ID');
  }
  if (!String(process.env.AZURE_CLIENT_SECRET || '').trim()) {
    missing.push('AZURE_CLIENT_SECRET');
  }
  return missing;
};

const getMissingRemoteRunnerEnv = (): string[] => {
  return String(process.env.PIPELINE_SERVICE_URL || '').trim()
    ? []
    : ['PIPELINE_SERVICE_URL'];
};

const getPipelineWorkerHeartbeatSummary = async (): Promise<{
  total: number;
  byRunner: Record<PipelineRunnerType, number>;
  bySource: Record<WorkerHeartbeatSourceType, number>;
  byRunnerSource: Record<WorkerHeartbeatSourceType, Record<PipelineRunnerType, number>>;
}> => {
  const byRunner: Record<PipelineRunnerType, number> = {
    local: 0,
    azure: 0,
    remote: 0,
  };
  const bySource: Record<WorkerHeartbeatSourceType, number> = {
    dedicated: 0,
    embedded: 0,
  };
  const byRunnerSource: Record<WorkerHeartbeatSourceType, Record<PipelineRunnerType, number>> = {
    dedicated: {
      local: 0,
      azure: 0,
      remote: 0,
    },
    embedded: {
      local: 0,
      azure: 0,
      remote: 0,
    },
  };

  const redisClient = connection as any;
  if (!redisClient || !process.env.REDIS_URL) {
    return { total: 0, byRunner, bySource, byRunnerSource };
  }

  try {
    let cursor = '0';
    const allKeys: string[] = [];

    do {
      const scanResult = await redisClient.scan(
        cursor,
        'MATCH',
        'pipeline:worker:heartbeat:*',
        'COUNT',
        100
      );
      cursor = Array.isArray(scanResult) ? String(scanResult[0] ?? '0') : '0';
      const keys = Array.isArray(scanResult) && Array.isArray(scanResult[1]) ? scanResult[1] : [];
      if (Array.isArray(keys) && keys.length > 0) {
        allKeys.push(...keys.map((key: unknown) => String(key)));
      }
    } while (cursor !== '0');

    if (allKeys.length === 0) {
      return { total: 0, byRunner, bySource, byRunnerSource };
    }

    const rawValues = await redisClient.mget(...allKeys);
    const values: unknown[] = Array.isArray(rawValues) ? rawValues : [];

    values.forEach((entry) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        return;
      }
      try {
        const payload = JSON.parse(entry) as { runner?: unknown; source?: unknown; embedded?: unknown };
        const source = normalizeWorkerHeartbeatSource(
          typeof payload?.source !== 'undefined'
            ? payload.source
            : (payload?.embedded ? 'embedded' : 'dedicated')
        );
        bySource[source] += 1;

        const runner = normalizePipelineRunner(payload?.runner);
        if (runner) {
          byRunner[runner] += 1;
          byRunnerSource[source][runner] += 1;
        }
      } catch {
        // Ignore malformed heartbeat payloads.
      }
    });

    return {
      total: allKeys.length,
      byRunner,
      bySource,
      byRunnerSource,
    };
  } catch (error) {
    console.warn('[Admin] Failed to inspect pipeline worker heartbeats:', error);
    return { total: 0, byRunner, bySource, byRunnerSource };
  }
};

export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const totalUsers = await User.countDocuments();
  const totalActiveSubscriptions = await User.countDocuments({
    subscriptionStatus: 'active',
    subscriptionExpiresAt: { $gt: new Date() },
  });

  // Active users can be defined as users who have a non-free plan, OR have connected youtube accounts recently. Let's just track connected ones.
  const activeUsers = await User.countDocuments({ isYoutubeConnected: true });

  const totalJobs = await Job.countDocuments();
  const successfulJobs = await Job.countDocuments({ status: 'success' });
  const failedJobs = await Job.countDocuments({ status: 'failed' });

  const successRate = totalJobs > 0 ? ((successfulJobs / totalJobs) * 100).toFixed(2) + '%' : '0%';
  const failureRate = totalJobs > 0 ? ((failedJobs / totalJobs) * 100).toFixed(2) + '%' : '0%';

  // Placeholder calculation
  const totalEarnings = totalActiveSubscriptions * 10;

  res.status(200).json({
    success: true,
    data: {
      totalUsers,
      activeUsers,
      totalActiveSubscriptions,
      totalEarnings,
      jobs: {
        total: totalJobs,
        successful: successfulJobs,
        failed: failedJobs,
        successRate,
        failureRate
      }
    },
  });
});

const notificationSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required'),
    message: z.string().min(1, 'Message is required'),
    type: z.enum(['info', 'warning', 'critical']).default('info'),
    targetPlans: z.array(z.enum(['free', 'basic', 'pro', 'premium'])).nonempty('At least one plan must be selected'),
    sendEmail: z.boolean().default(false),
  }),
});

export const createNotification = asyncHandler(async (req: Request, res: Response) => {
  const validation = notificationSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { title, message, type, targetPlans, sendEmail } = validation.data.body;

  const notification = await Notification.create({
    title,
    message,
    type,
    targetPlans,
    sendEmail,
  });

  if (sendEmail) {
    const usersToEmail = await User.find({ plan: { $in: targetPlans } }).select('email');
    const emailJobs = usersToEmail.map(user => ({
      name: 'emailJob',
      data: {
        to: user.email,
        subject: title,
        message,
      },
    }));

    if (emailJobs.length > 0) {
      await emailQueue.addBulk(emailJobs);
    }
  }

  res.status(201).json({
    success: true,
    message: 'Notification created successfully',
    data: notification,
  });
});

const bannerSchema = z.object({
  body: z.object({
    message: z.string()
      .max(200, 'Banner message must be at most 200 characters')
      .refine(s => !s.includes('\n'), { message: 'Banner message must be a single line (no newlines)' })
      .optional(),
    isActive: z.boolean().default(true),
    type: z.enum([
      'info-blue',
      'info-cyan',
      'info-green',
      'info-purple',
      'warning-amber',
      'warning-gold',
      'critical-red',
      'critical-rose',
    ]).default('info-blue'),
    startAt: z.string().optional().nullable(),
    endAt: z.string().optional().nullable(),
  }),
});

export const getSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  let config = await SystemConfig.findOne().sort({ updatedAt: -1 });
  if (!config) {
    config = await SystemConfig.create({
      betaMode: false,
      pipelineRunner: 'local',
      pipelineRunnerPinned: false,
      runEmbeddedWorker: false,
      autoStartEmbeddedWorkerWhenMissing: false,
      includeEmbeddedWorkersInRuntimeStatus: false,
      pipelineWorkerProfile: 'local',
      pipelineWorkerConcurrency: null,
      pipelineConcurrencyByPlan: sanitizePipelineConcurrencyByPlan(undefined),
      pipelineRetriesByPlan: sanitizePipelineRetriesByPlan(undefined),
      pipelineRunnerFallbackOrder: sanitizePipelineRunnerFallbackOrder(undefined),
      jobHistoryLimitByPlan: sanitizeJobHistoryLimitByPlan(undefined),
      jobHistoryMinAgeDays: sanitizeJobHistoryMinAgeDays(undefined),
      queueWaitTimeoutMinutes: DEFAULT_QUEUE_WAIT_TIMEOUT_MINUTES,
      processingHardTimeoutMinutes: DEFAULT_PROCESSING_HARD_TIMEOUT_MINUTES,
    });
  } else {
    // Ensure only one config doc exists.
    await SystemConfig.deleteMany({ _id: { $ne: config._id } });
  }

  res.status(200).json({
    success: true,
    data: config,
  });
});

export const getPipelineRuntimeStatus = asyncHandler(async (req: Request, res: Response) => {
  const heartbeatSummary = await getPipelineWorkerHeartbeatSummary();
  const redisEnabled = Boolean(process.env.REDIS_URL);
  const redisStatus = redisEnabled
    ? String((connection as any)?.status || 'unknown')
    : 'disabled';

  let config: any = null;
  try {
    config = await SystemConfig.findOne()
      .sort({ updatedAt: -1 })
      .select(
        'pipelineRunner pipelineRunnerFallbackOrder pipelineRunnerPinned runEmbeddedWorker autoStartEmbeddedWorkerWhenMissing includeEmbeddedWorkersInRuntimeStatus pipelineWorkerProfile pipelineWorkerConcurrency'
      );
  } catch (error) {
    console.warn('[Admin] Failed to load SystemConfig for runtime status:', error);
  }

  const configPrimary = normalizePipelineRunner(config?.pipelineRunner);
  const envPrimary = normalizePipelineRunner(process.env.PIPELINE_RUNNER);
  const envPinnedFallback = parseBooleanEnv(process.env.PIPELINE_RUNNER_PINNED, false);
  const effectivePinned = typeof config?.pipelineRunnerPinned === 'boolean'
    ? config.pipelineRunnerPinned
    : envPinnedFallback;
  const fallbackOrder = sanitizePipelineRunnerFallbackOrder(config?.pipelineRunnerFallbackOrder);
  const autoPrimary: PipelineRunnerType = String(process.env.PIPELINE_SERVICE_URL || '').trim()
    ? 'remote'
    : 'local';
  const effectivePrimary = effectivePinned
    ? (envPrimary || configPrimary || autoPrimary)
    : (configPrimary || envPrimary || autoPrimary);

  const missingAzureEnv = getMissingAzureRunnerEnv();
  const missingRemoteEnv = getMissingRemoteRunnerEnv();
  const localRuntime = resolveLocalPythonRuntime();
  const includeEmbeddedWorkersInConnectivity = typeof config?.includeEmbeddedWorkersInRuntimeStatus === 'boolean'
    ? config.includeEmbeddedWorkersInRuntimeStatus
    : parseBooleanEnv(process.env.INCLUDE_EMBEDDED_WORKERS_IN_RUNTIME_STATUS, false);
  const embeddedWorkerConfigured = typeof config?.runEmbeddedWorker === 'boolean'
    ? config.runEmbeddedWorker
    : parseBooleanEnv(process.env.RUN_EMBEDDED_WORKER, false);
  const autoStartEmbeddedWorkerWhenMissing = typeof config?.autoStartEmbeddedWorkerWhenMissing === 'boolean'
    ? config.autoStartEmbeddedWorkerWhenMissing
    : parseBooleanEnv(process.env.AUTO_START_EMBEDDED_WORKER_WHEN_MISSING, false);
  const workerRuntimeProfile = normalizePipelineWorkerProfile(
    typeof config?.pipelineWorkerProfile !== 'undefined'
      ? config.pipelineWorkerProfile
      : process.env.PIPELINE_WORKER_PROFILE
  );
  const workerRuntimeConcurrency = normalizePipelineWorkerConcurrency(
    typeof config?.pipelineWorkerConcurrency !== 'undefined'
      ? config.pipelineWorkerConcurrency
      : process.env.PIPELINE_WORKER_CONCURRENCY
  );
  const dedicatedWorkersByRunner = heartbeatSummary.byRunnerSource.dedicated;
  const embeddedWorkersByRunner = heartbeatSummary.byRunnerSource.embedded;

  const localConnected = dedicatedWorkersByRunner.local > 0 || (includeEmbeddedWorkersInConnectivity && embeddedWorkersByRunner.local > 0);
  const azureConnected = dedicatedWorkersByRunner.azure > 0 || (includeEmbeddedWorkersInConnectivity && embeddedWorkersByRunner.azure > 0);
  const remoteConnected = dedicatedWorkersByRunner.remote > 0 || (includeEmbeddedWorkersInConnectivity && embeddedWorkersByRunner.remote > 0);

  const localConfigured = localRuntime.available;
  const azureConfigured = missingAzureEnv.length === 0;
  const remoteConfigured = missingRemoteEnv.length === 0;

  res.status(200).json({
    success: true,
    data: {
      redis: {
        enabled: redisEnabled,
        status: redisStatus,
      },
      workerHeartbeats: heartbeatSummary,
      dedicatedWorkerHeartbeats: heartbeatSummary.bySource.dedicated,
      embeddedWorkerHeartbeats: heartbeatSummary.bySource.embedded,
      includeEmbeddedWorkersInConnectivity,
      runners: {
        local: {
          connected: localConnected,
          configured: localConfigured,
          ready: localConnected && localConfigured,
          activeWorkers: dedicatedWorkersByRunner.local,
          embeddedWorkers: embeddedWorkersByRunner.local,
          missingEnv: localRuntime.available
            ? []
            : [localRuntime.reason || 'PYTHON_RUNTIME_NOT_FOUND'],
        },
        azure: {
          connected: azureConnected,
          configured: azureConfigured,
          ready: azureConnected && azureConfigured,
          activeWorkers: dedicatedWorkersByRunner.azure,
          embeddedWorkers: embeddedWorkersByRunner.azure,
          missingEnv: missingAzureEnv,
        },
        remote: {
          connected: remoteConnected,
          configured: remoteConfigured,
          ready: remoteConnected && remoteConfigured,
          activeWorkers: dedicatedWorkersByRunner.remote,
          embeddedWorkers: embeddedWorkersByRunner.remote,
          missingEnv: missingRemoteEnv,
        },
      },
      runnerSelection: {
        effectivePrimary,
        systemConfigPrimary: configPrimary,
        envPrimary,
        envPinned: effectivePinned,
        mode: effectivePinned ? 'pinned' : 'dynamic',
        fallbackOrder,
      },
      workerRuntime: {
        profile: workerRuntimeProfile,
        concurrency: workerRuntimeConcurrency,
      },
      embeddedWorkerConfigured,
      autoStartEmbeddedWorkerWhenMissing,
    },
  });
});

const configSchema = z.object({
  body: z.object({
    betaMode: z.boolean(),
    pipelineRunner: z.enum(['local', 'azure', 'remote']).optional(),
    pipelineRunnerPinned: z.boolean().optional(),
    runEmbeddedWorker: z.boolean().optional(),
    autoStartEmbeddedWorkerWhenMissing: z.boolean().optional(),
    includeEmbeddedWorkersInRuntimeStatus: z.boolean().optional(),
    pipelineWorkerProfile: z.enum(['local', 'vm', 'cloud']).optional(),
    pipelineWorkerConcurrency: z.number().int().min(1).max(32).nullable().optional(),
    pipelineConcurrencyByPlan: z
      .object({
        free: z.number().int().min(1).max(100),
        basic: z.number().int().min(1).max(100),
        pro: z.number().int().min(1).max(100),
        premium: z.number().int().min(1).max(100),
      })
      .optional(),
    pipelineRetriesByPlan: z
      .object({
        free: z.number().min(0).max(10),
        basic: z.number().min(0).max(10),
        pro: z.number().min(0).max(10),
        premium: z.number().min(0).max(10),
      })
      .optional(),
    pipelineRunnerFallbackOrder: z
      .array(z.enum(['local', 'azure', 'remote']))
      .min(1)
      .max(3)
      .optional(),
    jobHistoryLimitByPlan: z
      .object({
        free: z.number().int().min(1).max(5000),
        basic: z.number().int().min(1).max(5000),
        pro: z.number().int().min(1).max(5000),
        premium: z.number().int().min(1).max(5000),
      })
      .optional(),
    jobHistoryMinAgeDays: z.number().int().min(1).max(3650).optional(),
    queueWaitTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
    processingHardTimeoutMinutes: z.number().int().min(10).max(1440).optional(),
    planValueMap: z
      .object({
        free: z.number(),
        basic: z.number(),
        pro: z.number(),
        premium: z.number(),
      })
      .optional(),
  }),
});

const timeoutConfigSchema = z.object({
  body: z.object({
    perVideoTimeoutMs: z.number().positive(),
    baseTimeoutMs: z.number().positive(),
  }),
});

export const updateTimeoutConfig = asyncHandler(async (req: Request, res: Response) => {
  const validation = timeoutConfigSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { perVideoTimeoutMs, baseTimeoutMs } = validation.data.body;

  const config = await SystemConfig.findOneAndUpdate(
    {},
    { perVideoTimeoutMs, baseTimeoutMs },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );

  // Cleanup any stale duplicates.
  await SystemConfig.deleteMany({ _id: { $ne: config._id } });

  res.status(200).json({
    success: true,
    message: 'Timeout configuration updated successfully',
    data: {
      perVideoTimeoutMs: config.perVideoTimeoutMs,
      baseTimeoutMs: config.baseTimeoutMs,
    },
  });
});

export const updateSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  const validation = configSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const {
    betaMode,
    pipelineRunnerPinned,
    runEmbeddedWorker,
    autoStartEmbeddedWorkerWhenMissing,
    includeEmbeddedWorkersInRuntimeStatus,
    pipelineWorkerProfile,
    pipelineWorkerConcurrency,
    planValueMap,
    pipelineConcurrencyByPlan,
    pipelineRetriesByPlan,
    pipelineRunnerFallbackOrder,
    jobHistoryLimitByPlan,
    jobHistoryMinAgeDays,
    queueWaitTimeoutMinutes,
    processingHardTimeoutMinutes,
  } = validation.data.body;
  const updatePayload: any = { betaMode };
  if (validation.data.body.pipelineRunner) {
    updatePayload.pipelineRunner = validation.data.body.pipelineRunner;
  }
  if (typeof pipelineRunnerPinned === 'boolean') {
    updatePayload.pipelineRunnerPinned = pipelineRunnerPinned;
  }
  if (typeof runEmbeddedWorker === 'boolean') {
    updatePayload.runEmbeddedWorker = runEmbeddedWorker;
  }
  if (typeof autoStartEmbeddedWorkerWhenMissing === 'boolean') {
    updatePayload.autoStartEmbeddedWorkerWhenMissing = autoStartEmbeddedWorkerWhenMissing;
  }
  if (typeof includeEmbeddedWorkersInRuntimeStatus === 'boolean') {
    updatePayload.includeEmbeddedWorkersInRuntimeStatus = includeEmbeddedWorkersInRuntimeStatus;
  }
  if (pipelineWorkerProfile) {
    updatePayload.pipelineWorkerProfile = normalizePipelineWorkerProfile(pipelineWorkerProfile);
  }
  if (typeof pipelineWorkerConcurrency !== 'undefined') {
    updatePayload.pipelineWorkerConcurrency = normalizePipelineWorkerConcurrency(pipelineWorkerConcurrency);
  }
  if (pipelineConcurrencyByPlan) {
    updatePayload.pipelineConcurrencyByPlan = sanitizePipelineConcurrencyByPlan(pipelineConcurrencyByPlan);
  }
  if (pipelineRetriesByPlan) {
    updatePayload.pipelineRetriesByPlan = sanitizePipelineRetriesByPlan(pipelineRetriesByPlan);
  }
  if (pipelineRunnerFallbackOrder) {
    updatePayload.pipelineRunnerFallbackOrder = sanitizePipelineRunnerFallbackOrder(pipelineRunnerFallbackOrder);
  }
  if (jobHistoryLimitByPlan) {
    updatePayload.jobHistoryLimitByPlan = sanitizeJobHistoryLimitByPlan(jobHistoryLimitByPlan);
  }
  if (typeof jobHistoryMinAgeDays === 'number') {
    updatePayload.jobHistoryMinAgeDays = sanitizeJobHistoryMinAgeDays(jobHistoryMinAgeDays);
  }
  if (typeof queueWaitTimeoutMinutes === 'number') {
    updatePayload.queueWaitTimeoutMinutes = Math.max(5, Math.min(1440, Math.floor(queueWaitTimeoutMinutes)));
  }
  if (typeof processingHardTimeoutMinutes === 'number') {
    updatePayload.processingHardTimeoutMinutes = Math.max(10, Math.min(1440, Math.floor(processingHardTimeoutMinutes)));
  }
  if (planValueMap) {
    updatePayload.planValueMap = planValueMap;
  }
  const config = await SystemConfig.findOneAndUpdate(
    {},
    updatePayload,
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );
  // Cleanup any stale duplicates.
  await SystemConfig.deleteMany({ _id: { $ne: config._id } });

  res.status(200).json({
    success: true,
    message: 'System config updated successfully',
    data: config,
  });
});

export const setGlobalBanner = asyncHandler(async (req: Request, res: Response) => {
  const validation = bannerSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { message, isActive, type, startAt, endAt } = validation.data.body;

  let banner = await GlobalBanner.findOne();
  const normalizedMessage = (message || '').trim();

  if (isActive && normalizedMessage.length === 0) {
    throw new AppError('Banner message is required', 400);
  }

  if (banner) {
    if (normalizedMessage.length > 0) {
      banner.message = normalizedMessage;
    }
    banner.isActive = isActive;
    banner.type = type;
    banner.startAt = startAt ? new Date(startAt) : null as any;
    banner.endAt = endAt ? new Date(endAt) : null as any;
    await banner.save();
  } else {
    if (isActive && normalizedMessage.length === 0) {
      throw new AppError('Banner message is required when creating a new banner', 400);
    }
    banner = await GlobalBanner.create({
      // Allow creating an inactive banner record even if message is blank.
      message: normalizedMessage.length > 0 ? normalizedMessage : '   ',
      isActive,
      type,
      startAt: startAt ? new Date(startAt) : null as any,
      endAt: endAt ? new Date(endAt) : null as any,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Global banner updated successfully',
    data: banner,
  });
});

export const getGlobalBannerConfig = asyncHandler(async (req: Request, res: Response) => {
  const banner = await GlobalBanner.findOne();
  res.status(200).json({
    success: true,
    data: banner || null,
  });
});

export const deleteUserByAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Stripe disabled. If you need Razorpay cancellation, implement it here.

  // Store in DeletedUsers collection
  await DeletedUser.create({
    email: user.email,
    planHistory: [user.plan],
    usageStats: {
      uploadsUsedTotal: user.uploadsUsedToday,
    },
    deletedAt: new Date(),
  });

  // Remove pending jobs from BullMQ queue to save resources
  try {
    const activeJobs = await pipelineQueue.getJobs(['waiting', 'delayed']);
    for (const job of activeJobs) {
      if (id && job.data.userId === id.toString()) {
        await job.remove();
      }
    }
  } catch (error) {
    console.error('Failed to cleanup BullMQ jobs during admin deletion:', error);
  }

  // Delete user from active users
  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
  });
});

export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const limitRaw = Number(req.query.limit);
  const pageRaw = Number(req.query.page);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 10;
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const search = String(req.query.search || '').trim();
  const cursor = String(req.query.cursor || '').trim();

  const query: any = {};
  if (search) {
    const escapedSearch = escapeRegex(search);
    query.email = { $regex: escapedSearch, $options: 'i' };
  }

  const usingCursorPagination = cursor.length > 0;
  if (cursor) {
    query._id = { $lt: cursor };
  }

  const baseUsersQuery = User.find(query)
    .select('email role plan uploadsUsedToday uploadsOnHold subscriptionExpiresAt createdAt')
    .sort({ _id: -1 });

  const users = usingCursorPagination
    ? await baseUsersQuery.limit(limit + 1)
    : await baseUsersQuery.skip((page - 1) * limit).limit(limit);

  let nextCursor = null;
  if (usingCursorPagination && users.length > limit) {
    const nextUser = users.pop();
    nextCursor = nextUser?._id;
  }

  const total = await User.countDocuments(query);
  const pages = Math.max(1, Math.ceil(total / limit));

  res.status(200).json({
    success: true,
    data: users,
    pagination: {
      total,
      limit,
      page,
      pages,
      nextCursor,
    },
  });
});

export const getUserDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.id || '').trim();
  if (!userId) {
    throw new AppError('User id is required', 400);
  }

  // Refresh lazy daily reset + hold reconciliation before returning admin usage stats.
  await getUploadLimits(userId).catch((error) => {
    console.warn(`[Admin] Failed to refresh upload counters for user ${userId}:`, error);
  });

  await applyUserJobHistoryRetention(userId).catch((error) => {
    console.warn(`[Admin] Failed to apply job history retention for user ${userId}:`, error);
  });

  const user = await User.findById(userId).select('-password');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const jobs = await Job.find({ userId }).sort({ createdAt: -1 });
  const prompts = await Prompt.find({ userId }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: {
      user,
      jobs,
      prompts,
    },
  });
});

const updateUserPlanSchema = z.object({
  body: z.object({
    plan: z.enum(SUPPORTED_PLANS, {
      message: "plan must be 'free', 'basic', 'pro', or 'premium'",
    }),
    subscriptionExpiresAt: z.string().optional().nullable(),
  }),
});

const createAdminSchema = z.object({
  body: z.object({
    email: z
      .string({ message: 'Email is required' })
      .trim()
      .email('Enter a valid email address'),
    password: z
      .string({ message: 'Password is required' })
      .min(8, 'Password must be at least 8 characters long')
      .regex(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*?&]+$/, 'Password must contain at least one letter and one number'),
    role: z.enum(STAFF_ROLES).default('admin'),
  }),
});

export const createAdminUser = asyncHandler(async (req: Request, res: Response) => {
  const validation = createAdminSchema.safeParse({ body: req.body });

  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const normalizedEmail = String(validation.data.body.email || '').trim().toLowerCase();
  const password = validation.data.body.password;
  const role = validation.data.body.role;
  const roleLabel = role === 'helper' ? 'helper' : 'admin';

  if (!validator.isEmail(normalizedEmail)) {
    throw new AppError('Enter a valid email address', 400);
  }

  const existing = await User.findOne({ email: normalizedEmail }).select('role');
  if (existing?.role) {
    if (existing.role === role) {
      throw new AppError(`A ${roleLabel} account already exists with this email`, 409);
    }

    throw new AppError('An account already exists with this email', 409);
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  let createdAdmin: any = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      createdAdmin = await User.create({
        email: normalizedEmail,
        password: hashedPassword,
        provider: 'local',
        role,
        plan: 'free',
        subscriptionStatus: 'inactive',
        isEmailVerified: true,
        referralCode: generateReferralCode(),
      });
      break;
    } catch (error: any) {
      const duplicateReferralCode = error?.code === 11000 && Boolean(error?.keyPattern?.referralCode);
      if (duplicateReferralCode) {
        continue;
      }
      throw error;
    }
  }

  if (!createdAdmin) {
    throw new AppError(`Failed to create ${roleLabel} user. Please retry.`, 500);
  }

  res.status(201).json({
    success: true,
    message: `${roleLabel === 'helper' ? 'Helper' : 'Admin'} user created successfully`,
    data: {
      _id: createdAdmin.id,
      email: createdAdmin.email,
      role: createdAdmin.role,
      plan: createdAdmin.plan,
      createdAt: createdAdmin.createdAt,
    },
  });
});

export const updateUserPlan = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    throw new AppError('User id is required', 400);
  }
  const validation = updateUserPlanSchema.safeParse({ body: req.body });

  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const { plan, subscriptionExpiresAt } = validation.data.body;

  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  user.plan = plan;

  if (subscriptionExpiresAt) {
    user.subscriptionExpiresAt = new Date(subscriptionExpiresAt);
    user.subscriptionStatus = 'active'; // Assuming setting a date makes it active
  } else if (subscriptionExpiresAt === null) {
    user.set('subscriptionExpiresAt', undefined);
    user.subscriptionStatus = plan === 'free' ? 'inactive' : 'active';
  }

  await user.save();

  await applyUserJobHistoryRetention(id).catch((error) => {
    console.warn(`[Admin] Failed to apply job history retention after plan update for user ${id}:`, error);
  });

  res.status(200).json({
    success: true,
    message: 'User plan updated successfully',
    data: {
      _id: user.id,
      email: user.email,
      plan: user.plan,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      subscriptionStatus: user.subscriptionStatus,
    },
  });
});

export const getPlans = asyncHandler(async (req: Request, res: Response) => {
  const plans = await Plan.find().sort({ price: 1, name: 1 });
  res.status(200).json({
    success: true,
    data: plans,
  });
});

const updatePlanSchema = z.object({
  body: z
    .object({
      price: z.coerce.number().min(0).max(1000000).optional(),
      discountPercentage: z.coerce.number().min(0).max(100).optional(),
      priority_weight: z.coerce.number().int().min(0).max(1000).optional(),
      is_active: z.boolean().optional(),
      featuresList: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
      features: z
        .object({
          voice_selection: z.boolean().optional(),
          scheduling: z.boolean().optional(),
          multi_channel: z.boolean().optional(),
          story_mode: z.boolean().optional(),
          cta: z.boolean().optional(),
          format_selection: z.boolean().optional(),
          template_customization: z.boolean().optional(),
          custom_media: z.boolean().optional(),
        })
        .strict()
        .optional(),
      limits: z
        .object({
          max_channels: z.coerce.number().int().min(1).max(500).optional(),
          daily_upload_limit: z.coerce.number().int().min(1).max(5000).optional(),
          max_media_items: z.coerce.number().int().min(1).max(5000).optional(),
          max_video_items: z.coerce.number().int().min(1).max(5000).optional(),
          max_image_items: z.coerce.number().int().min(1).max(5000).optional(),
          max_thumbnail_items: z.coerce.number().int().min(1).max(5000).optional(),
          max_clip_length_seconds: z.coerce.number().int().min(1).max(86400).optional(),
          max_total_video_duration_seconds: z.coerce.number().int().min(1).max(86400).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'No valid plan fields provided for update',
    }),
});

export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    throw new AppError('Plan id is required', 400);
  }

  const validation = updatePlanSchema.safeParse({ body: req.body });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((issue: any) => issue.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const payload: any = validation.data.body;
  if (Array.isArray(payload.featuresList)) {
    payload.featuresList = Array.from(new Set(payload.featuresList.map((item: string) => item.trim()).filter(Boolean)));
  }

  const plan = await Plan.findByIdAndUpdate(id, payload, { new: true, runValidators: true });

  if (!plan) {
    throw new AppError('Plan not found', 404);
  }

  res.status(200).json({
    success: true,
    message: 'Plan updated successfully',
    data: plan,
  });
});

export const triggerWeeklyReports = asyncHandler(async (req: Request, res: Response) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const activeUsers = await User.find({
    plan: { $in: ['basic', 'pro', 'premium'] }
  }).select('email _id');

  let emailsQueued = 0;

  for (const user of activeUsers) {
    const weeklyJobs = await Job.countDocuments({
      userId: user._id,
      status: 'success',
      createdAt: { $gte: oneWeekAgo }
    });

    if (weeklyJobs > 0) {
      await emailQueue.add('emailJob', {
        to: user.email,
        subject: 'Your Weekly ClipForge Analytics',
        message: `Hello!

You successfully generated and uploaded ${weeklyJobs} videos over the past 7 days. Keep up the great work and watch your channels grow!

- The ClipForge Team`
      });
      emailsQueued++;
    }
  }

  res.status(200).json({
    success: true,
    message: `Weekly report triggered successfully. Queued ${emailsQueued} emails.`,
  });
});
