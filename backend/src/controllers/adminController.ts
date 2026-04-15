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
  getPipelineAttemptsForPlan,
  getMinimumAttemptsForRunnerCycles,
  sanitizePipelineCycleAcrossRunners,
  sanitizePipelineRetryCycles,
  sanitizePipelineRetriesByPlan,
  sanitizePipelineRunnerFallbackOrder,
} from '../services/pipelineRetryPolicyService';
import { sanitizePipelineConcurrencyByPlan } from '../services/pipelineConcurrencyPolicyService';
import {
  applyUserJobHistoryRetention,
  sanitizeJobHistoryLimitByPlan,
  sanitizeJobHistoryMinAgeDays,
} from '../services/jobHistoryRetentionPolicyService';
import { getUploadLimits, releaseReservedCredits } from '../services/uploadLimitService';
import { decrementChannelVideosOnHold, resolveJobChannelId } from '../services/channelHoldService';
import { connection, redisEnabled } from '../config/redis';
import { resolveLocalPythonRuntime } from '../workers/localPipelineTrigger';
import { getAzureToken, stopAzureJobExecution } from '../workers/azureJobTrigger';
import { getConfiguredGeminiModel, getGeminiModelCatalog } from '../services/geminiModelService';
import {
  DEFAULT_COMPOSITION_HEARTBEAT_SECONDS,
  DEFAULT_FFMPEG_COMMAND_TIMEOUT_SECONDS,
  resolveDefaultPipelineExecutionTimeoutMinutes,
  resolvePipelineExecutionTimeoutMs,
  sanitizeCompositionHeartbeatSeconds,
  sanitizeFfmpegCommandTimeoutSeconds,
  sanitizePipelineExecutionTimeoutMinutes,
} from '../services/pipelineRuntimeControlService';

// Stripe disabled. Using Razorpay for payments.

const SUPPORTED_PLANS = ['free', 'basic', 'pro', 'premium'] as const;
const STAFF_ROLES = ['admin', 'helper'] as const;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MINUTES = 100;
const DEFAULT_PROCESSING_HARD_TIMEOUT_MINUTES = 100;
const SUPPORTED_PIPELINE_RUNNERS = ['local', 'azure', 'remote'] as const;
const SUPPORTED_PIPELINE_WORKER_PROFILES = ['local', 'vm', 'cloud'] as const;
const SUPPORTED_WORKER_HEARTBEAT_SOURCES = ['dedicated', 'embedded'] as const;
const DEFAULT_PENDING_RETRY_SCAN_LIMIT = 100;
const MAX_PENDING_RETRY_SCAN_LIMIT = 500;
const PIPELINE_QUEUE_PREVIEW_LIMIT = 5;
const PIPELINE_QUEUE_PREVIEW_STATES = ['active', 'waiting', 'prioritized', 'delayed'] as const;
const ACTIVE_PIPELINE_JOB_STATUSES = ['pending', 'processing'] as const;
const ACTIVE_PIPELINE_JOB_DEFAULT_LIMIT = 25;
const ACTIVE_PIPELINE_JOB_MAX_LIMIT = 100;
const ADMIN_STOP_REASON_MIN_LENGTH = 5;
const ADMIN_STOP_REASON_MAX_LENGTH = 500;
const ADMIN_STOP_QUEUE_STATES: Array<'waiting' | 'delayed' | 'prioritized' | 'paused'> = [
  'waiting',
  'delayed',
  'prioritized',
  'paused',
];

type PipelineRunnerType = (typeof SUPPORTED_PIPELINE_RUNNERS)[number];
type PipelineWorkerProfileType = (typeof SUPPORTED_PIPELINE_WORKER_PROFILES)[number];
type WorkerHeartbeatSourceType = (typeof SUPPORTED_WORKER_HEARTBEAT_SOURCES)[number];
type PipelineQueuePreviewState = (typeof PIPELINE_QUEUE_PREVIEW_STATES)[number];

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

const normalizePipelineServiceUrl = (value: unknown): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\/+$/, '').slice(0, 500);
};

const normalizePipelineServiceSecret = (value: unknown): string => {
  return String(value || '').trim().slice(0, 500);
};

const normalizeGeminiModel = (value: unknown): string => {
  const normalized = String(value || '').trim().replace(/^models\//i, '');
  if (!normalized) {
    return String(process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview').trim() || 'gemini-3.1-flash-lite-preview';
  }
  return normalized.slice(0, 120);
};

const normalizeWorkerHeartbeatSource = (value: unknown): WorkerHeartbeatSourceType => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'embedded') {
    return 'embedded';
  }
  return 'dedicated';
};

const AZURE_RUNTIME_AUTH_CACHE_TTL_MS = 60 * 1000;
let cachedAzureRuntimeAuth: {
  expiresAt: number;
  error: string;
} | null = null;

const normalizeAzureRuntimeAuthError = (value: unknown): string => {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
};

const getAzureRuntimeAuthError = async (forceRefresh = false): Promise<string> => {
  const now = Date.now();
  if (!forceRefresh && cachedAzureRuntimeAuth && cachedAzureRuntimeAuth.expiresAt > now) {
    return cachedAzureRuntimeAuth.error;
  }

  let authError = '';
  const missingEnv = getMissingAzureRunnerEnv();
  if (missingEnv.length === 0) {
    try {
      await getAzureToken();
    } catch (error: any) {
      const description =
        error?.response?.data?.error_description ||
        error?.response?.data?.error ||
        error?.message ||
        'Azure token request failed';
      authError = normalizeAzureRuntimeAuthError(description);
    }
  }

  cachedAzureRuntimeAuth = {
    error: authError,
    expiresAt: now + AZURE_RUNTIME_AUTH_CACHE_TTL_MS,
  };
  return authError;
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

const getMissingRemoteRunnerEnv = (serviceUrlFromConfig?: unknown): string[] => {
  const configuredUrl = normalizePipelineServiceUrl(serviceUrlFromConfig);
  const envUrl = normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL);
  const effectiveUrl = configuredUrl || envUrl;
  return effectiveUrl
    ? []
    : ['PIPELINE_SERVICE_URL'];
};

const clampPendingRetryScanLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PENDING_RETRY_SCAN_LIMIT;
  }
  return Math.max(1, Math.min(MAX_PENDING_RETRY_SCAN_LIMIT, Math.floor(parsed)));
};

const getRequestedUploadCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
};

const clampActiveJobLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return ACTIVE_PIPELINE_JOB_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(ACTIVE_PIPELINE_JOB_MAX_LIMIT, Math.floor(parsed)));
};

const normalizeAdminStopReason = (value: unknown): string => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, ADMIN_STOP_REASON_MAX_LENGTH);
};

const inferRunnerFromLogs = (logs: unknown): PipelineRunnerType | null => {
  const text = String(logs || '');
  if (!text.trim()) {
    return null;
  }

  const regex = /"selectedRunner":"(local|azure|remote)"/gi;
  let match: RegExpExecArray | null = regex.exec(text);
  let lastRunner: PipelineRunnerType | null = null;
  while (match) {
    const candidate = normalizePipelineRunner(match[1]);
    if (candidate) {
      lastRunner = candidate;
    }
    match = regex.exec(text);
  }

  if (lastRunner) {
    return lastRunner;
  }

  if (/Dispatching local pipeline process/i.test(text)) {
    return 'local';
  }
  if (/Successfully dispatched Azure Container App Job/i.test(text)) {
    return 'azure';
  }
  if (/Dispatching remote pipeline service/i.test(text)) {
    return 'remote';
  }
  return null;
};

const parseAzureExecutionNameFromLogs = (logs: unknown): string => {
  const text = String(logs || '');
  if (!text.trim()) {
    return '';
  }
  const regex = /execution=([A-Za-z0-9._-]+)/g;
  let match: RegExpExecArray | null = regex.exec(text);
  let lastExecution = '';
  while (match) {
    const candidate = String(match[1] || '').trim();
    if (candidate) {
      lastExecution = candidate;
    }
    match = regex.exec(text);
  }
  return lastExecution;
};

const getDbJobIdFromQueueEntry = (queueEntry: any): string => {
  const entryJobId = queueEntry?.data?.jobId;
  if (typeof entryJobId === 'string' && entryJobId.trim()) {
    return entryJobId.trim();
  }
  if (entryJobId != null) {
    return String(entryJobId).trim();
  }
  return '';
};

const removeQueuedPipelineEntriesForDbJob = async (dbJobId: string): Promise<number> => {
  if (!dbJobId || !pipelineQueue || typeof (pipelineQueue as any).getJobs !== 'function') {
    return 0;
  }

  const candidates: any[] = [];
  try {
    const queuedEntries = await (pipelineQueue as any).getJobs(ADMIN_STOP_QUEUE_STATES);
    if (Array.isArray(queuedEntries)) {
      candidates.push(...queuedEntries);
    }
  } catch (error) {
    console.warn(`[Admin] Failed to scan queue states while stopping job ${dbJobId}:`, error);
  }

  if (typeof (pipelineQueue as any).getJob === 'function') {
    try {
      const directEntry = await (pipelineQueue as any).getJob(dbJobId);
      if (directEntry) {
        candidates.push(directEntry);
      }
    } catch (error) {
      console.warn(`[Admin] Failed to fetch direct queue entry for job ${dbJobId}:`, error);
    }
  }

  const matchingEntries = new Map<string, any>();
  for (const entry of candidates) {
    const queueId = String(entry?.id || '').trim();
    if (!queueId) {
      continue;
    }
    const mappedDbJobId = getDbJobIdFromQueueEntry(entry);
    if (mappedDbJobId === dbJobId || queueId === dbJobId) {
      matchingEntries.set(queueId, entry);
    }
  }

  let removedCount = 0;
  for (const entry of matchingEntries.values()) {
    try {
      await entry.remove();
      removedCount += 1;
    } catch (error) {
      console.warn(`[Admin] Failed to remove queue entry ${String(entry?.id || 'unknown')} for job ${dbJobId}:`, error);
    }
  }

  return removedCount;
};

const resolveQueueAttemptBudgetForPlan = (plan: string, config: any): number => {
  const baseAttempts = getPipelineAttemptsForPlan(plan, config as any);
  const fallbackOrder = sanitizePipelineRunnerFallbackOrder(config?.pipelineRunnerFallbackOrder);
  const configPrimary = normalizePipelineRunner(config?.pipelineRunner);
  const envPrimary = normalizePipelineRunner(process.env.PIPELINE_RUNNER);
  const envPinnedFallback = parseBooleanEnv(process.env.PIPELINE_RUNNER_PINNED, false);
  const effectivePinned = typeof config?.pipelineRunnerPinned === 'boolean'
    ? config.pipelineRunnerPinned
    : envPinnedFallback;
  const remoteConfigured = Boolean(
    normalizePipelineServiceUrl(config?.pipelineServiceUrl) || normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL)
  );
  const autoPrimary: PipelineRunnerType = remoteConfigured ? 'remote' : 'local';
  const effectivePrimary = effectivePinned
    ? (envPrimary || configPrimary || autoPrimary)
    : (configPrimary || envPrimary || autoPrimary);
  const runnerSequence = [effectivePrimary, ...fallbackOrder.filter((runner) => runner !== effectivePrimary)];
  const retryCycles = sanitizePipelineRetryCycles(config?.pipelineRetryCycles);
  const cycleAcrossRunners = sanitizePipelineCycleAcrossRunners(config?.pipelineCycleAcrossRunners, true);
  const minimumCycleAttempts = cycleAcrossRunners
    ? getMinimumAttemptsForRunnerCycles(runnerSequence.length, retryCycles)
    : 1;
  return Math.max(1, Math.max(baseAttempts, minimumCycleAttempts));
};

const clearDispatchLocksForJob = async (jobId: string): Promise<number> => {
  const redisClient = connection as any;
  if (!redisClient || !process.env.REDIS_URL || !jobId) {
    return 0;
  }

  try {
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      const scanResult = await redisClient.scan(
        cursor,
        'MATCH',
        `pipeline:dispatch:${jobId}:*`,
        'COUNT',
        100
      );
      cursor = Array.isArray(scanResult) ? String(scanResult[0] ?? '0') : '0';
      const keys = Array.isArray(scanResult) && Array.isArray(scanResult[1])
        ? scanResult[1].map((key: unknown) => String(key))
        : [];
      if (keys.length > 0) {
        keysToDelete.push(...keys);
      }
    } while (cursor !== '0');

    if (keysToDelete.length === 0) {
      return 0;
    }

    await redisClient.del(...keysToDelete);
    return keysToDelete.length;
  } catch (error) {
    console.warn(`[Admin] Failed to clear dispatch locks for job ${jobId}:`, error);
    return 0;
  }
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

const getPipelineQueueSnapshot = async (): Promise<{
  enabled: boolean;
  available: boolean;
  counts: {
    waiting: number;
    active: number;
    prioritized: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  };
  preview: Array<{
    queueId: string;
    mongoJobId: string | null;
    state: PipelineQueuePreviewState;
    attemptsMade: number;
    priority: number;
    enqueuedAt: string | null;
    startedAt: string | null;
    ageSeconds: number | null;
  }>;
  sampleLimitPerState: number;
  error?: string;
}> => {
  const emptySnapshot = {
    enabled: redisEnabled,
    available: false,
    counts: {
      waiting: 0,
      active: 0,
      prioritized: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
      paused: 0,
    },
    preview: [] as Array<{
      queueId: string;
      mongoJobId: string | null;
      state: PipelineQueuePreviewState;
      attemptsMade: number;
      priority: number;
      enqueuedAt: string | null;
      startedAt: string | null;
      ageSeconds: number | null;
    }>,
    sampleLimitPerState: PIPELINE_QUEUE_PREVIEW_LIMIT,
  };

  if (!redisEnabled || !connection) {
    return emptySnapshot;
  }

  const queueClient = pipelineQueue as any;
  if (
    !queueClient ||
    typeof queueClient.getJobCounts !== 'function' ||
    typeof queueClient.getJobs !== 'function'
  ) {
    return {
      ...emptySnapshot,
      error: 'Queue runtime client is unavailable.',
    };
  }

  try {
    const [countsRaw, previewByState] = await Promise.all([
      queueClient.getJobCounts(
        'waiting',
        'active',
        'prioritized',
        'delayed',
        'completed',
        'failed',
        'paused'
      ),
      Promise.all(
        PIPELINE_QUEUE_PREVIEW_STATES.map(async (state) => {
          const jobsRaw = await queueClient.getJobs([state], 0, PIPELINE_QUEUE_PREVIEW_LIMIT - 1, false);
          const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];
          const now = Date.now();

          return jobs.map((job: any) => {
            const enqueuedAtMs = Number(job?.timestamp);
            const startedAtMs = Number(job?.processedOn);
            const rawPriority = Number(job?.opts?.priority);
            const rawAttempts = Number(job?.attemptsMade);
            const mongoJobIdRaw = job?.data?.jobId;

            return {
              queueId: String(job?.id ?? ''),
              mongoJobId: typeof mongoJobIdRaw === 'string' || typeof mongoJobIdRaw === 'number'
                ? String(mongoJobIdRaw)
                : null,
              state,
              attemptsMade: Number.isFinite(rawAttempts) ? rawAttempts : 0,
              priority: Number.isFinite(rawPriority) ? rawPriority : 0,
              enqueuedAt: Number.isFinite(enqueuedAtMs) && enqueuedAtMs > 0
                ? new Date(enqueuedAtMs).toISOString()
                : null,
              startedAt: Number.isFinite(startedAtMs) && startedAtMs > 0
                ? new Date(startedAtMs).toISOString()
                : null,
              ageSeconds: Number.isFinite(enqueuedAtMs) && enqueuedAtMs > 0
                ? Math.max(0, Math.floor((now - enqueuedAtMs) / 1000))
                : null,
            };
          });
        })
      ),
    ]);

    const counts = {
      waiting: Number.isFinite(Number(countsRaw?.waiting)) ? Number(countsRaw.waiting) : 0,
      active: Number.isFinite(Number(countsRaw?.active)) ? Number(countsRaw.active) : 0,
      prioritized: Number.isFinite(Number(countsRaw?.prioritized)) ? Number(countsRaw.prioritized) : 0,
      delayed: Number.isFinite(Number(countsRaw?.delayed)) ? Number(countsRaw.delayed) : 0,
      completed: Number.isFinite(Number(countsRaw?.completed)) ? Number(countsRaw.completed) : 0,
      failed: Number.isFinite(Number(countsRaw?.failed)) ? Number(countsRaw.failed) : 0,
      paused: Number.isFinite(Number(countsRaw?.paused)) ? Number(countsRaw.paused) : 0,
    };

    return {
      enabled: true,
      available: true,
      counts,
      preview: previewByState.flat(),
      sampleLimitPerState: PIPELINE_QUEUE_PREVIEW_LIMIT,
    };
  } catch (error: any) {
    return {
      ...emptySnapshot,
      error: String(error?.message || 'Failed to read queue snapshot.'),
    };
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
      geminiModel: normalizeGeminiModel(undefined),
      pipelineRunner: 'local',
      pipelineServiceUrl: '',
      pipelineServiceSecret: '',
      pipelineRunnerPinned: false,
      ffmpegCommandTimeoutSeconds: sanitizeFfmpegCommandTimeoutSeconds(undefined),
      compositionHeartbeatSeconds: sanitizeCompositionHeartbeatSeconds(undefined),
      pipelineExecutionTimeoutMinutes: resolveDefaultPipelineExecutionTimeoutMinutes(),
      runEmbeddedWorker: false,
      autoStartEmbeddedWorkerWhenMissing: false,
      includeEmbeddedWorkersInRuntimeStatus: false,
      pipelineWorkerProfile: 'local',
      pipelineWorkerConcurrency: null,
      pipelineConcurrencyByPlan: sanitizePipelineConcurrencyByPlan(undefined),
      pipelineRetriesByPlan: sanitizePipelineRetriesByPlan(undefined),
      pipelineRetryCycles: sanitizePipelineRetryCycles(undefined),
      pipelineCycleAcrossRunners: sanitizePipelineCycleAcrossRunners(undefined, true),
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

export const getGeminiModels = asyncHandler(async (req: Request, res: Response) => {
  const forceRefresh = String(req.query.refresh || '').trim().toLowerCase() === 'true';
  const [selectedModel, catalog] = await Promise.all([
    getConfiguredGeminiModel(forceRefresh),
    getGeminiModelCatalog(forceRefresh),
  ]);

  res.status(200).json({
    success: true,
    data: {
      selectedModel,
      models: catalog.models,
      source: catalog.source,
      fetchedAt: catalog.fetchedAt,
    },
  });
});

export const getPipelineRuntimeStatus = asyncHandler(async (req: Request, res: Response) => {
  const heartbeatSummary = await getPipelineWorkerHeartbeatSummary();
  const queueSnapshot = await getPipelineQueueSnapshot();
  const redisEnabled = Boolean(process.env.REDIS_URL);
  const redisStatus = redisEnabled
    ? String((connection as any)?.status || 'unknown')
    : 'disabled';

  let config: any = null;
  try {
    config = await SystemConfig.findOne()
      .sort({ updatedAt: -1 })
      .select(
        'pipelineRunner pipelineServiceUrl pipelineServiceSecret pipelineRunnerFallbackOrder pipelineRetryCycles pipelineCycleAcrossRunners pipelineRunnerPinned runEmbeddedWorker autoStartEmbeddedWorkerWhenMissing includeEmbeddedWorkersInRuntimeStatus pipelineWorkerProfile pipelineWorkerConcurrency ffmpegCommandTimeoutSeconds compositionHeartbeatSeconds pipelineExecutionTimeoutMinutes'
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
  const effectivePipelineServiceUrl = normalizePipelineServiceUrl(config?.pipelineServiceUrl) || normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL);
  const autoPrimary: PipelineRunnerType = effectivePipelineServiceUrl
    ? 'remote'
    : 'local';
  const effectivePrimary = effectivePinned
    ? (envPrimary || configPrimary || autoPrimary)
    : (configPrimary || envPrimary || autoPrimary);

  const pipelineRetryCycles = sanitizePipelineRetryCycles(config?.pipelineRetryCycles);
  const pipelineCycleAcrossRunners = sanitizePipelineCycleAcrossRunners(config?.pipelineCycleAcrossRunners, true);
  const runnerSequence = [effectivePrimary, ...fallbackOrder.filter((runner) => runner !== effectivePrimary)];
  const minimumAttemptsPerJob = pipelineCycleAcrossRunners
    ? getMinimumAttemptsForRunnerCycles(runnerSequence.length, pipelineRetryCycles)
    : 1;

  const missingAzureEnv = getMissingAzureRunnerEnv();
  const effectiveMissingAzureEnv = [...missingAzureEnv];
  if (effectiveMissingAzureEnv.length === 0) {
    const azureRuntimeAuthError = await getAzureRuntimeAuthError();
    if (azureRuntimeAuthError) {
      effectiveMissingAzureEnv.push(`AZURE_AUTH_INVALID:${azureRuntimeAuthError}`);
    }
  }
  const missingRemoteEnv = getMissingRemoteRunnerEnv(config?.pipelineServiceUrl);
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
  const ffmpegCommandTimeoutSeconds = sanitizeFfmpegCommandTimeoutSeconds(config?.ffmpegCommandTimeoutSeconds);
  const compositionHeartbeatSeconds = sanitizeCompositionHeartbeatSeconds(config?.compositionHeartbeatSeconds);
  const pipelineExecutionTimeoutMinutes =
    sanitizePipelineExecutionTimeoutMinutes(config?.pipelineExecutionTimeoutMinutes)
    ?? resolveDefaultPipelineExecutionTimeoutMinutes();
  const dedicatedWorkersByRunner = heartbeatSummary.byRunnerSource.dedicated;
  const embeddedWorkersByRunner = heartbeatSummary.byRunnerSource.embedded;

  // Treat embedded API workers as connectivity evidence per runner when that
  // specific runner has no dedicated workers alive.
  const embeddedOnlyFallbackByRunner = {
    local: dedicatedWorkersByRunner.local === 0 && embeddedWorkersByRunner.local > 0,
    azure: dedicatedWorkersByRunner.azure === 0 && embeddedWorkersByRunner.azure > 0,
    remote: dedicatedWorkersByRunner.remote === 0 && embeddedWorkersByRunner.remote > 0,
  };

  const localConnected = dedicatedWorkersByRunner.local > 0 || ((includeEmbeddedWorkersInConnectivity || embeddedOnlyFallbackByRunner.local) && embeddedWorkersByRunner.local > 0);
  const azureConnected = dedicatedWorkersByRunner.azure > 0 || ((includeEmbeddedWorkersInConnectivity || embeddedOnlyFallbackByRunner.azure) && embeddedWorkersByRunner.azure > 0);
  const remoteConnected = dedicatedWorkersByRunner.remote > 0 || ((includeEmbeddedWorkersInConnectivity || embeddedOnlyFallbackByRunner.remote) && embeddedWorkersByRunner.remote > 0);

  const includeEmbeddedWorkersInConnectivityEffective =
    includeEmbeddedWorkersInConnectivity ||
    embeddedOnlyFallbackByRunner.local ||
    embeddedOnlyFallbackByRunner.azure ||
    embeddedOnlyFallbackByRunner.remote;

  const localConfigured = localRuntime.available;
  const azureConfigured = effectiveMissingAzureEnv.length === 0;
  const remoteConfigured = missingRemoteEnv.length === 0;

  res.status(200).json({
    success: true,
    data: {
      redis: {
        enabled: redisEnabled,
        status: redisStatus,
      },
      queue: queueSnapshot,
      workerHeartbeats: heartbeatSummary,
      dedicatedWorkerHeartbeats: heartbeatSummary.bySource.dedicated,
      embeddedWorkerHeartbeats: heartbeatSummary.bySource.embedded,
      includeEmbeddedWorkersInConnectivity: includeEmbeddedWorkersInConnectivityEffective,
      embeddedOnlyFallbackConnectivity:
        embeddedOnlyFallbackByRunner.local ||
        embeddedOnlyFallbackByRunner.azure ||
        embeddedOnlyFallbackByRunner.remote,
      embeddedOnlyFallbackByRunner,
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
          missingEnv: effectiveMissingAzureEnv,
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
      retryPolicy: {
        cycleAcrossRunners: pipelineCycleAcrossRunners,
        retryCycles: pipelineRetryCycles,
        runnerSequence,
        minimumAttemptsPerJob,
      },
      remoteRunner: {
        serviceUrl: effectivePipelineServiceUrl,
        hasSecret: Boolean(normalizePipelineServiceSecret(config?.pipelineServiceSecret) || String(process.env.PIPELINE_SERVICE_SECRET || '').trim() || String(process.env.WEBHOOK_SECRET || '').trim()),
      },
      workerRuntime: {
        profile: workerRuntimeProfile,
        concurrency: workerRuntimeConcurrency,
      },
      runtimeControls: {
        ffmpegCommandTimeoutSeconds,
        compositionHeartbeatSeconds,
        pipelineExecutionTimeoutMinutes,
      },
      embeddedWorkerConfigured,
      autoStartEmbeddedWorkerWhenMissing,
    },
  });
});

const configSchema = z.object({
  body: z.object({
    betaMode: z.boolean(),
    geminiModel: z.string().trim().min(1).max(120).optional(),
    pipelineRunner: z.enum(['local', 'azure', 'remote']).optional(),
    pipelineServiceUrl: z.string().max(500).optional(),
    pipelineServiceSecret: z.string().max(500).optional(),
    pipelineRunnerPinned: z.boolean().optional(),
    ffmpegCommandTimeoutSeconds: z.number().min(30).max(7200).optional(),
    compositionHeartbeatSeconds: z.number().min(5).max(600).optional(),
    pipelineExecutionTimeoutMinutes: z.number().min(0.5).max(240).nullable().optional(),
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
    pipelineRetryCycles: z.number().int().min(1).max(10).optional(),
    pipelineCycleAcrossRunners: z.boolean().optional(),
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
    pipelineServiceUrl,
    pipelineServiceSecret,
    geminiModel,
    pipelineRunnerPinned,
    ffmpegCommandTimeoutSeconds,
    compositionHeartbeatSeconds,
    pipelineExecutionTimeoutMinutes,
    runEmbeddedWorker,
    autoStartEmbeddedWorkerWhenMissing,
    includeEmbeddedWorkersInRuntimeStatus,
    pipelineWorkerProfile,
    pipelineWorkerConcurrency,
    planValueMap,
    pipelineConcurrencyByPlan,
    pipelineRetriesByPlan,
    pipelineRetryCycles,
    pipelineCycleAcrossRunners,
    pipelineRunnerFallbackOrder,
    jobHistoryLimitByPlan,
    jobHistoryMinAgeDays,
    queueWaitTimeoutMinutes,
    processingHardTimeoutMinutes,
  } = validation.data.body;
  const updatePayload: any = { betaMode };
  if (typeof geminiModel !== 'undefined') {
    updatePayload.geminiModel = normalizeGeminiModel(geminiModel);
  }
  if (validation.data.body.pipelineRunner) {
    updatePayload.pipelineRunner = validation.data.body.pipelineRunner;
  }
  if (typeof pipelineServiceUrl !== 'undefined') {
    updatePayload.pipelineServiceUrl = normalizePipelineServiceUrl(pipelineServiceUrl);
  }
  if (typeof pipelineServiceSecret !== 'undefined') {
    updatePayload.pipelineServiceSecret = normalizePipelineServiceSecret(pipelineServiceSecret);
  }
  if (typeof pipelineRunnerPinned === 'boolean') {
    updatePayload.pipelineRunnerPinned = pipelineRunnerPinned;
  }
  if (typeof ffmpegCommandTimeoutSeconds !== 'undefined') {
    updatePayload.ffmpegCommandTimeoutSeconds = sanitizeFfmpegCommandTimeoutSeconds(ffmpegCommandTimeoutSeconds);
  }
  if (typeof compositionHeartbeatSeconds !== 'undefined') {
    updatePayload.compositionHeartbeatSeconds = sanitizeCompositionHeartbeatSeconds(compositionHeartbeatSeconds);
  }
  if (typeof pipelineExecutionTimeoutMinutes !== 'undefined') {
    updatePayload.pipelineExecutionTimeoutMinutes = sanitizePipelineExecutionTimeoutMinutes(pipelineExecutionTimeoutMinutes);
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
  if (typeof pipelineRetryCycles === 'number') {
    updatePayload.pipelineRetryCycles = sanitizePipelineRetryCycles(pipelineRetryCycles);
  }
  if (typeof pipelineCycleAcrossRunners === 'boolean') {
    updatePayload.pipelineCycleAcrossRunners = sanitizePipelineCycleAcrossRunners(pipelineCycleAcrossRunners, true);
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

const retryPendingJobsSchema = z.object({
  body: z.object({
    limit: z.number().int().min(1).max(MAX_PENDING_RETRY_SCAN_LIMIT).optional(),
  }).optional(),
});

export const retryPendingPipelineJobs = asyncHandler(async (req: Request, res: Response) => {
  const validation = retryPendingJobsSchema.safeParse({ body: req.body || {} });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const limit = clampPendingRetryScanLimit(validation.data.body?.limit);
  const config = await SystemConfig.findOne()
    .sort({ updatedAt: -1 })
    .select(
      'pipelineRetriesByPlan pipelineRunner pipelineRunnerFallbackOrder pipelineRunnerPinned pipelineServiceUrl pipelineRetryCycles pipelineCycleAcrossRunners pipelineExecutionTimeoutMinutes'
    )
    .lean();

  const pendingJobs = await Job.find({ status: 'pending' })
    .sort({ queuedAt: 1, createdAt: 1 })
    .limit(limit)
    .select('_id userId promptId pipelineConfig videoCount');

  let requeued = 0;
  let alreadyQueued = 0;
  let skipped = 0;
  let failed = 0;
  let clearedDispatchLocks = 0;

  for (const pendingJob of pendingJobs) {
    const dbJobId = String(pendingJob._id || '').trim();
    const userId = String((pendingJob as any).userId || '').trim();
    const promptId = String((pendingJob as any).promptId || '').trim();

    if (!dbJobId || !userId || !promptId) {
      skipped += 1;
      continue;
    }

    try {
      const existingQueueJob = await pipelineQueue.getJob(dbJobId);
      if (existingQueueJob) {
        alreadyQueued += 1;
        continue;
      }

      clearedDispatchLocks += await clearDispatchLocksForJob(dbJobId);

      const planName = String((pendingJob as any)?.pipelineConfig?.plan || 'free').trim().toLowerCase();
      const jobAttempts = resolveQueueAttemptBudgetForPlan(planName, config || {});
      const requestedCount = getRequestedUploadCount((pendingJob as any)?.videoCount || (pendingJob as any)?.pipelineConfig?.videoCount);
      const jobTimeoutMs = resolvePipelineExecutionTimeoutMs(
        (pendingJob as any)?.pipelineConfig?.pipelineExecutionTimeoutMinutes ?? (config as any)?.pipelineExecutionTimeoutMinutes,
        requestedCount
      );

      const planPriorities: Record<string, number> = {
        premium: 1,
        pro: 2,
        basic: 3,
        free: 4,
      };
      const priority = planPriorities[planName] || 4;

      await pipelineQueue.add(
        'runPipeline',
        {
          userId,
          promptId,
          jobId: dbJobId,
          settings: (pendingJob as any).pipelineConfig || {},
        },
        {
          priority,
          jobId: dbJobId,
          attempts: jobAttempts,
          timeout: jobTimeoutMs,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnFail: true,
        }
      );

      requeued += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[Admin] Failed to requeue pending job ${dbJobId}:`, error);
    }
  }

  res.status(200).json({
    success: true,
    message: 'Pending job requeue scan completed.',
    data: {
      scanned: pendingJobs.length,
      requeued,
      alreadyQueued,
      skipped,
      failed,
      clearedDispatchLocks,
      limit,
    },
  });
});

const activePipelineJobsSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(ACTIVE_PIPELINE_JOB_MAX_LIMIT).optional(),
  }).optional(),
});

const stopPipelineJobSchema = z.object({
  params: z.object({
    jobId: z.string().trim().min(1),
  }),
  body: z.object({
    reason: z.string().trim().min(ADMIN_STOP_REASON_MIN_LENGTH).max(ADMIN_STOP_REASON_MAX_LENGTH),
  }),
});

export const getActivePipelineJobs = asyncHandler(async (req: Request, res: Response) => {
  const validation = activePipelineJobsSchema.safeParse({ query: req.query || {} });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const limit = clampActiveJobLimit(validation.data.query?.limit);

  const activeJobs = await Job.find({ status: { $in: [...ACTIVE_PIPELINE_JOB_STATUSES] } })
    .sort({ startedAt: -1, queuedAt: -1, createdAt: -1 })
    .limit(limit)
    .select('_id userId status channelId videoCount queuedAt startedAt updatedAt progress logs result holdConsumed holdReleased pipelineConfig');

  const userIds = Array.from(
    new Set(
      activeJobs
        .map((job) => String((job as any)?.userId || '').trim())
        .filter(Boolean)
    )
  );

  const users = userIds.length > 0
    ? await User.find({ _id: { $in: userIds } }).select('_id email').lean()
    : [];
  const userEmailMap = new Map<string, string>(
    users.map((user: any) => [String(user._id), String(user.email || '')])
  );

  const now = Date.now();
  const jobs = activeJobs.map((job: any) => {
    const dispatch = (job?.result && typeof job.result === 'object') ? (job.result.dispatch || {}) : {};
    const derivedRunner =
      normalizePipelineRunner(dispatch?.runner) ||
      inferRunnerFromLogs(job.logs) ||
      null;

    const azureExecutionName =
      String(dispatch?.azureExecutionName || dispatch?.executionName || '').trim() ||
      parseAzureExecutionNameFromLogs(job.logs);

    const referenceTime =
      (job.startedAt instanceof Date ? job.startedAt : null) ||
      (job.queuedAt instanceof Date ? job.queuedAt : null) ||
      (job.updatedAt instanceof Date ? job.updatedAt : null);

    const elapsedSeconds =
      referenceTime && Number.isFinite(referenceTime.getTime())
        ? Math.max(0, Math.floor((now - referenceTime.getTime()) / 1000))
        : null;

    return {
      _id: String(job._id),
      userId: String(job.userId || ''),
      userEmail: userEmailMap.get(String(job.userId || '')) || '',
      status: String(job.status || ''),
      channelId: String(job.channelId || resolveJobChannelId(job) || ''),
      videoCount: getRequestedUploadCount(job.videoCount || job?.pipelineConfig?.videoCount),
      queuedAt: job.queuedAt instanceof Date ? job.queuedAt.toISOString() : null,
      startedAt: job.startedAt instanceof Date ? job.startedAt.toISOString() : null,
      updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : null,
      elapsedSeconds,
      progress: {
        progress: Number.isFinite(Number(job?.progress?.progress)) ? Number(job.progress.progress) : 0,
        stage: String(job?.progress?.stage || ''),
        message: String(job?.progress?.message || ''),
        timestamp: String(job?.progress?.timestamp || ''),
      },
      runner: derivedRunner,
      azureExecutionName: azureExecutionName || null,
      holdConsumed: Boolean(job.holdConsumed),
      holdReleased: Boolean(job.holdReleased),
      canStop: String(job.status || '') === 'pending' || String(job.status || '') === 'processing',
    };
  });

  res.status(200).json({
    success: true,
    data: {
      limit,
      total: jobs.length,
      jobs,
    },
  });
});

export const stopPipelineJobByAdmin = asyncHandler(async (req: Request, res: Response) => {
  const validation = stopPipelineJobSchema.safeParse({ params: req.params, body: req.body || {} });
  if (!validation.success) {
    const errorMessages = validation.error.issues.map((e: any) => e.message).join(', ');
    throw new AppError(errorMessages, 400);
  }

  const jobId = String(validation.data.params.jobId || '').trim();
  const reason = normalizeAdminStopReason(validation.data.body.reason);
  if (reason.length < ADMIN_STOP_REASON_MIN_LENGTH) {
    throw new AppError(`Reason must be at least ${ADMIN_STOP_REASON_MIN_LENGTH} characters.`, 400);
  }

  const dbJob = await Job.findById(jobId)
    .select('_id userId status channelId videoCount pipelineConfig logs result holdConsumed holdReleased progress');
  if (!dbJob) {
    throw new AppError('Job not found.', 404);
  }

  const currentStatus = String((dbJob as any)?.status || '');
  if (!ACTIVE_PIPELINE_JOB_STATUSES.includes(currentStatus as any)) {
    throw new AppError('Only pending or processing jobs can be stopped.', 400);
  }

  const requestedCount = getRequestedUploadCount((dbJob as any)?.videoCount || (dbJob as any)?.pipelineConfig?.videoCount);
  const userId = String((dbJob as any)?.userId || '').trim();
  const channelId = resolveJobChannelId(dbJob as any);

  const dispatch = ((dbJob as any)?.result && typeof (dbJob as any).result === 'object')
    ? (((dbJob as any).result as any).dispatch || {})
    : {};
  const runner = normalizePipelineRunner(dispatch?.runner) || inferRunnerFromLogs((dbJob as any)?.logs);
  const azureExecutionName =
    String(dispatch?.azureExecutionName || dispatch?.executionName || '').trim() ||
    parseAzureExecutionNameFromLogs((dbJob as any)?.logs);
  const azureJobName = String(dispatch?.azureJobName || process.env.AZURE_JOB_NAME || '').trim();

  let azureStopAttempted = false;
  let azureStopSucceeded = false;
  let azureStopMessage = '';

  if (runner === 'azure' && azureExecutionName && azureJobName) {
    azureStopAttempted = true;
    try {
      const stopResult = await stopAzureJobExecution(azureJobName, azureExecutionName);
      azureStopSucceeded = Boolean(stopResult.success);
      azureStopMessage = String(stopResult.message || '').trim();
    } catch (error: any) {
      azureStopMessage = String(error?.message || error || '').trim();
    }
  }

  const [clearedDispatchLocks, removedQueueEntries] = await Promise.all([
    clearDispatchLocksForJob(jobId),
    removeQueuedPipelineEntriesForDbJob(jobId),
  ]);

  const shouldReleaseHolds = !Boolean((dbJob as any).holdConsumed) && !Boolean((dbJob as any).holdReleased);
  const stoppedAt = new Date();
  const stoppedBy = String((req as any)?.user?.id || '').trim();
  const stopError = `Stopped by admin: ${reason}`;
  const existingLogs = typeof (dbJob as any)?.logs === 'string' ? (dbJob as any).logs : '';
  const stopLog = `[ADMIN_STOP] ${stoppedAt.toISOString()} reason="${reason}"${stoppedBy ? ` by=${stoppedBy}` : ''}`;

  const nextResult = {
    ...(((dbJob as any)?.result && typeof (dbJob as any).result === 'object') ? (dbJob as any).result : {}),
    dispatch: {
      ...dispatch,
      ...(runner ? { runner } : {}),
      ...(azureJobName ? { azureJobName } : {}),
      ...(azureExecutionName ? { azureExecutionName } : {}),
    },
    adminStop: {
      reason,
      stoppedAt: stoppedAt.toISOString(),
      stoppedBy: stoppedBy || null,
      runner: runner || null,
      azureExecutionName: azureExecutionName || null,
      azureStopAttempted,
      azureStopSucceeded,
      azureStopMessage: azureStopMessage || null,
      clearedDispatchLocks,
      removedQueueEntries,
    },
  };

  const updatePayload: any = {
    status: 'failed',
    completedAt: stoppedAt,
    error: stopError,
    errorMessage: stopError,
    errorStage: 'RENDER',
    progress: {
      progress: 100,
      stage: 'failed',
      message: 'Stopped by admin',
      timestamp: stoppedAt.toISOString(),
    },
    logs: `${existingLogs}${existingLogs.endsWith('\n') || !existingLogs ? '' : '\n'}${stopLog}\n`,
    result: nextResult,
    processedVideos: 0,
  };

  if (shouldReleaseHolds) {
    updatePayload.holdReleased = true;
    updatePayload.holdConsumed = false;
  }

  const updatedJob = await Job.findOneAndUpdate(
    { _id: jobId, status: { $in: [...ACTIVE_PIPELINE_JOB_STATUSES] } },
    { $set: updatePayload },
    { returnDocument: 'after' }
  );

  if (!updatedJob) {
    throw new AppError('Job is no longer active and could not be stopped.', 409);
  }

  let releasedCredits = 0;
  let releasedChannelHolds = 0;
  if (shouldReleaseHolds && userId) {
    try {
      await releaseReservedCredits(userId, requestedCount);
      releasedCredits = requestedCount;
    } catch (error) {
      console.warn(`[Admin] Failed to release reserved credits for job ${jobId}:`, error);
    }
    if (channelId) {
      try {
        releasedChannelHolds = await decrementChannelVideosOnHold(userId, channelId, requestedCount);
      } catch (error) {
        console.warn(`[Admin] Failed to decrement channel hold for job ${jobId}:`, error);
      }
    }
  }

  if (userId) {
    await applyUserJobHistoryRetention(userId).catch((error) => {
      console.warn(`[Admin] Failed to apply job history retention for user ${userId}:`, error);
    });
  }

  res.status(200).json({
    success: true,
    message: 'Pipeline job stopped successfully.',
    data: {
      jobId,
      status: 'failed',
      reason,
      runner: runner || null,
      azureExecutionName: azureExecutionName || null,
      azureStopAttempted,
      azureStopSucceeded,
      azureStopMessage: azureStopMessage || null,
      clearedDispatchLocks,
      removedQueueEntries,
      releasedCredits,
      releasedChannelHolds,
      stoppedAt: stoppedAt.toISOString(),
    },
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
