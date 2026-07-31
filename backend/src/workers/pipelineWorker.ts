import dotenv from 'dotenv';
import path from 'path';
import * as os from 'os';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { Worker, Job as BullJob, UnrecoverableError } from 'bullmq';
import { acquireLock, releaseLock } from '../utils/redisLock';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import { pipelineQueue } from '../queues/pipelineQueue';
import { connection } from '../config/redis';
import JobModel from '../models/Job';
import Prompt from '../models/Prompt';
import User from '../models/User';
import StoryProgress from '../models/StoryProgress';
import SystemConfig from '../models/SystemConfig';
import Media from '../models/Media';
import { ensureValidYouTubeToken } from '../services/youtubeTokenService';
import { generateContent } from '../services/contentGenerationService';
import { encrypt } from '../utils/encryption';
import { triggerAzureJob, resolveAzureArmApiVersion, stopAzureJobExecution } from './azureJobTrigger';
import { isLocalPipelineRuntimeAvailable, resolveLocalPythonRuntime, triggerLocalPipeline } from './localPipelineTrigger';
import { triggerRemotePipeline } from './remotePipelineTrigger';
import { triggerOracleJob } from './oracleJobTrigger';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { normalizePipelineSettings } from '../services/pipelineRunService';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}
import { PipelineJobPayload } from '../queues/pipelineQueue';
import {
  consumeReservedCredits,
  getConsumedUploadsLast24hForChannel,
  getCurrentUsageDayStartUtc,
  reconcileUserHoldCounters,
  releaseReservedCredits,
} from '../services/uploadLimitService';
import { applyUserJobHistoryRetention } from '../services/jobHistoryRetentionPolicyService';
import { notifyUser } from '../services/notificationService';
import { decrementChannelVideosOnHold, resolveJobChannelId } from '../services/channelHoldService';
import {
  buildRunnerSequence,
  pickRunnerForAttempt,
  sanitizePipelineCycleAcrossRunners,
  sanitizePipelineRetryCycles,
  sanitizePipelineRunnerFallbackOrder,
} from '../services/pipelineRetryPolicyService';
import {
  sanitizeCompositionHeartbeatSeconds,
  sanitizeFfmpegCommandTimeoutSeconds,
  sanitizePipelineExecutionTimeoutMinutes,
  resolvePipelineExecutionTimeoutMs,
} from '../services/pipelineRuntimeControlService';

// Load env vars

const hasYoutubeOAuthConfig = Boolean(
  (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
  (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET) &&
  (process.env.YOUTUBE_REDIRECT_URI || process.env.BACKEND_URL)
);
if (!hasYoutubeOAuthConfig) {
  console.warn(
    '[PipelineWorker] Missing YouTube OAuth env vars. Upload jobs will fail at TOKEN stage. Configure YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET and either YOUTUBE_REDIRECT_URI or BACKEND_URL.'
  );
}

const getRequestedUploadCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
};

// Connect to MongoDB BEFORE starting worker
if (mongoose.connection.readyState === 0) {
  connectDB();
}

console.log('Worker is starting and connected to Redis/MongoDB...');

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const clampInt = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, Math.floor(value)));
};

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

type WorkerProfileType = 'local' | 'vm' | 'cloud';

const normalizeWorkerProfile = (value: unknown): WorkerProfileType => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'vm') {
    return 'vm';
  }
  if (normalized === 'cloud' || normalized === 'azure') {
    return 'cloud';
  }
  return 'local';
};

const resolveDefaultConcurrencyForProfile = (profile: WorkerProfileType): number => {
  const cpuCount = Math.max(1, os.cpus().length || 1);
  if (profile === 'local') {
    return 1;
  }
  if (profile === 'vm') {
    return clampInt(Math.max(2, cpuCount - 1), 2, 16);
  }
  return clampInt(Math.max(4, cpuCount), 4, 24);
};

const resolveWorkerConcurrency = (profile: WorkerProfileType): number => {
  const explicitConcurrency = parsePositiveInt(process.env.PIPELINE_WORKER_CONCURRENCY, 0);
  if (explicitConcurrency > 0) {
    return clampInt(explicitConcurrency, 1, 32);
  }
  return resolveDefaultConcurrencyForProfile(profile);
};

const workerProfile = normalizeWorkerProfile(process.env.PIPELINE_WORKER_PROFILE);
const workerConcurrency = resolveWorkerConcurrency(workerProfile);
console.log(`[PipelineWorker] Worker profile=${workerProfile}, concurrency=${workerConcurrency}`);

const AZURE_AUTH_FAILURE_COOLDOWN_MS = clampInt(
  parsePositiveInt(process.env.AZURE_AUTH_FAILURE_COOLDOWN_MS, 5 * 60 * 1000),
  60 * 1000,
  60 * 60 * 1000
);

const AZURE_EXECUTION_TIMEOUT_GRACE_MS = clampInt(
  parsePositiveInt(process.env.AZURE_EXECUTION_TIMEOUT_GRACE_MS, 90_000),
  0,
  5 * 60 * 1000
);

let azureAuthFailureCache: {
  expiresAt: number;
  reason: string;
} | null = null;

const normalizeAzureAuthFailureReason = (value: unknown): string => {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
};

const isAzureCredentialErrorMessage = (value: unknown): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes('unauthorized_client') ||
    normalized.includes('invalid_client') ||
    /aadsts\d{6}/.test(normalized) ||
    (normalized.includes('application with identifier') && normalized.includes('not found in the directory'))
  );
};

const getActiveAzureAuthFailureReason = (): string => {
  if (!azureAuthFailureCache) {
    return '';
  }
  if (azureAuthFailureCache.expiresAt <= Date.now()) {
    azureAuthFailureCache = null;
    return '';
  }
  return azureAuthFailureCache.reason;
};

const markAzureAuthFailure = (reason: unknown): void => {
  const normalizedReason = normalizeAzureAuthFailureReason(reason);
  if (!normalizedReason) {
    return;
  }
  azureAuthFailureCache = {
    reason: normalizedReason,
    expiresAt: Date.now() + AZURE_AUTH_FAILURE_COOLDOWN_MS,
  };
  console.warn(`[PipelineWorker] Azure runner temporarily disabled after auth failure: ${normalizedReason}`);
};

const clearAzureAuthFailure = (): void => {
  azureAuthFailureCache = null;
};

const normalizePipelineRunner = (value: unknown): 'local' | 'azure' | 'remote' | 'oracle' | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'azure' || normalized === 'remote' || normalized === 'oracle') {
    return normalized;
  }
  return null;
};

const pipelineRunnerPinnedFallback = parseBooleanEnv(process.env.PIPELINE_RUNNER_PINNED, false);
const envPrimaryRunner = normalizePipelineRunner(process.env.PIPELINE_RUNNER);
const isEmbeddedWorkerProcess = parseBooleanEnv(process.env.PIPELINE_WORKER_EMBEDDED, false);
const HEARTBEAT_RUNNER_CACHE_MS = parsePositiveInt(process.env.PIPELINE_HEARTBEAT_RUNNER_CACHE_MS, 30000);

let heartbeatRunnerCache: {
  value: 'local' | 'azure' | 'remote' | 'oracle';
  expiresAt: number;
} | null = null;

const resolveHeartbeatRunner = async (): Promise<'local' | 'azure' | 'remote' | 'oracle'> => {
  const now = Date.now();
  if (heartbeatRunnerCache && heartbeatRunnerCache.expiresAt > now) {
    return heartbeatRunnerCache.value;
  }

  let configPrimary: 'local' | 'azure' | 'remote' | 'oracle' | null = null;
  let effectivePinned = pipelineRunnerPinnedFallback;
  try {
    const configDoc = await SystemConfig.findOne().sort({ updatedAt: -1 }).select('pipelineRunner pipelineRunnerPinned');
    configPrimary = normalizePipelineRunner((configDoc as any)?.pipelineRunner);
    if (typeof (configDoc as any)?.pipelineRunnerPinned === 'boolean') {
      effectivePinned = (configDoc as any).pipelineRunnerPinned;
    }
  } catch {
    // Best effort only; fall back to env and auto runner.
  }

  const autoPrimary: 'local' | 'azure' | 'remote' | 'oracle' = String(process.env.PIPELINE_SERVICE_URL || '').trim()
    ? 'remote'
    : 'local';
  const resolved = effectivePinned
    ? (envPrimaryRunner || configPrimary || autoPrimary)
    : (configPrimary || envPrimaryRunner || autoPrimary);

  heartbeatRunnerCache = {
    value: resolved,
    expiresAt: now + HEARTBEAT_RUNNER_CACHE_MS,
  };

  return resolved;
};

const WORKER_HEARTBEAT_INTERVAL_MS = parsePositiveInt(process.env.PIPELINE_WORKER_HEARTBEAT_MS, 10000);
const WORKER_HEARTBEAT_TTL_SEC = Math.max(15, Math.ceil((WORKER_HEARTBEAT_INTERVAL_MS * 3) / 1000));
const workerStartIso = new Date().toISOString();
const workerHeartbeatKey = `pipeline:worker:heartbeat:${process.pid}`;
let workerHeartbeatTimer: NodeJS.Timeout | null = null;

const publishWorkerHeartbeat = async (): Promise<void> => {
  try {
    const heartbeatRunner = await resolveHeartbeatRunner();
    await (connection as any).set(
      workerHeartbeatKey,
      JSON.stringify({
        pid: process.pid,
        hostname: process.env.HOSTNAME || 'unknown',
        startedAt: workerStartIso,
        runner: heartbeatRunner,
        profile: workerProfile,
        concurrency: workerConcurrency,
        source: isEmbeddedWorkerProcess ? 'embedded' : 'dedicated',
      }),
      'EX',
      WORKER_HEARTBEAT_TTL_SEC
    );
  } catch (error) {
    console.warn('[PipelineWorker] Failed to publish worker heartbeat:', error);
  }
};

const startWorkerHeartbeat = (): void => {
  void publishWorkerHeartbeat();
  workerHeartbeatTimer = setInterval(() => {
    void publishWorkerHeartbeat();
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  workerHeartbeatTimer.unref();
};

const stopWorkerHeartbeat = async (): Promise<void> => {
  if (workerHeartbeatTimer) {
    clearInterval(workerHeartbeatTimer);
    workerHeartbeatTimer = null;
  }

  try {
    await (connection as any).del(workerHeartbeatKey);
  } catch {
    // Best effort cleanup only
  }
};

const PIPELINE_QUEUE_SELF_HEAL_ENABLED = parseBooleanEnv(
  process.env.PIPELINE_QUEUE_SELF_HEAL_ENABLED,
  true
);
const PIPELINE_QUEUE_SELF_HEAL_INTERVAL_MS = clampInt(
  parsePositiveInt(process.env.PIPELINE_QUEUE_SELF_HEAL_INTERVAL_MS, 30000),
  10000,
  5 * 60 * 1000
);
const PIPELINE_QUEUE_SELF_HEAL_RESTART_THRESHOLD = clampInt(
  parsePositiveInt(process.env.PIPELINE_QUEUE_SELF_HEAL_RESTART_THRESHOLD, 6),
  2,
  60
);
const PIPELINE_QUEUE_MARKER_KEY = 'bull:pipelineQueue:marker';

let queueSelfHealTimer: NodeJS.Timeout | null = null;
let consecutiveQueueStallChecks = 0;

const ensurePipelineQueueWakeMarker = async (): Promise<void> => {
  if (!connection) {
    return;
  }
  try {
    await (connection as any).zadd(PIPELINE_QUEUE_MARKER_KEY, 0, '0');
  } catch (error) {
    console.warn('[PipelineWorker] Failed to restore queue wake marker:', error);
  }
};

const startQueueSelfHealWatchdog = (): void => {
  if (!PIPELINE_QUEUE_SELF_HEAL_ENABLED) {
    return;
  }

  queueSelfHealTimer = setInterval(() => {
    void (async () => {
      try {
        const queueCounts = await (pipelineQueue as any).getJobCounts('waiting', 'prioritized', 'active');
        const waitingJobs = Number((queueCounts as any)?.waiting || 0);
        const prioritizedJobs = Number((queueCounts as any)?.prioritized || 0);
        const activeJobs = Number((queueCounts as any)?.active || 0);
        const queuedJobs = waitingJobs + prioritizedJobs;

        if (queuedJobs > 0 && activeJobs === 0) {
          consecutiveQueueStallChecks += 1;
          await ensurePipelineQueueWakeMarker();

          console.warn(
            `[PipelineWorker] Queue stall watchdog: waiting=${waitingJobs}, prioritized=${prioritizedJobs}, active=${activeJobs}, consecutive=${consecutiveQueueStallChecks}`
          );

          if (
            !isEmbeddedWorkerProcess &&
            consecutiveQueueStallChecks >= PIPELINE_QUEUE_SELF_HEAL_RESTART_THRESHOLD
          ) {
            console.error(
              '[PipelineWorker] Queue appears stalled despite queued jobs. Exiting process so supervisor can restart the dedicated worker.'
            );
            process.exit(1);
          }
          return;
        }

        consecutiveQueueStallChecks = 0;
      } catch (error) {
        console.warn('[PipelineWorker] Queue stall watchdog check failed:', error);
      }
    })();
  }, PIPELINE_QUEUE_SELF_HEAL_INTERVAL_MS);

  queueSelfHealTimer.unref();
};

const stopQueueSelfHealWatchdog = (): void => {
  if (queueSelfHealTimer) {
    clearInterval(queueSelfHealTimer);
    queueSelfHealTimer = null;
  }
};

const MAX_LOG_SIZE = 100 * 1024; // Limit log to 100 KB

// Helper to batch log updates
const logBuffer: Record<string, { text: string; status?: string; timeout: NodeJS.Timeout | null }> = {};

const flushLogs = async (jobId: string) => {
  const buffer = logBuffer[jobId];
  if (!buffer || !buffer.text) return;

  const { text } = buffer;
  const statusToApply = buffer.status;
  // Clear buffer
  buffer.text = '';
  delete buffer.status;
  if (buffer.timeout) clearTimeout(buffer.timeout);
  buffer.timeout = null;

  try {
    const dbJob = await JobModel.findById(jobId);
    if (!dbJob) return;

    let combined = (dbJob.logs || '') + text;
    if (combined.length > MAX_LOG_SIZE) {
      combined = '...[LOGS TRUNCATED]...\n' + combined.substring(combined.length - MAX_LOG_SIZE);
    }

    const updateData: any = { logs: combined };
    if (statusToApply) {
      const currentStatus = String((dbJob as any).status || '').toLowerCase();
      const terminalStatuses = new Set(['success', 'failed']);
      if (!terminalStatuses.has(currentStatus)) {
        updateData.status = statusToApply;
      }
    }

    await JobModel.findByIdAndUpdate(jobId, updateData);
  } catch (error) {
    console.error(`Failed to flush logs for job ${jobId}`, error);
  }
};

const appendLogSafe = async (jobId: string, newText: string, status?: string): Promise<void> => {
  if (!logBuffer[jobId]) {
    logBuffer[jobId] = { text: '', timeout: null };
  }

  logBuffer[jobId].text += newText;
  if (status) {
    logBuffer[jobId].status = status;
  }

  // If status is provided (e.g. success/failed/running state change), force flush immediately
  if (status) {
    await flushLogs(jobId);
    return;
  }

  // Otherwise throttle writes to DB (e.g., every 3 seconds)
  if (!logBuffer[jobId].timeout) {
    logBuffer[jobId].timeout = setTimeout(() => {
      flushLogs(jobId);
    }, 3000);
  }
};

type PipelineRunner = 'local' | 'azure' | 'remote' | 'oracle';

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

const normalizePipelineServiceUrl = (value: unknown): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\/+$/, '');
};

const getMissingRemoteRunnerEnv = (serviceUrlFromConfig?: unknown): string[] => {
  const effectiveServiceUrl = normalizePipelineServiceUrl(serviceUrlFromConfig) || normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL);
  return effectiveServiceUrl ? [] : ['PIPELINE_SERVICE_URL'];
};

const isRunnerAvailable = (runner: PipelineRunner, options?: { remoteServiceUrl?: string }): boolean => {
  if (runner === 'azure') {
    if (getMissingAzureRunnerEnv().length > 0) {
      return false;
    }
    return !getActiveAzureAuthFailureReason();
  }
  if (runner === 'remote') {
    const effectiveRemoteServiceUrl = normalizePipelineServiceUrl(options?.remoteServiceUrl) || normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL);
    return Boolean(effectiveRemoteServiceUrl);
  }
  return isLocalPipelineRuntimeAvailable();
};

const resolvePipelineRunner = async (
  attemptsMade: number
): Promise<{
  runner: PipelineRunner;
  targetRunner: PipelineRunner;
  primary: PipelineRunner;
  sequence: PipelineRunner[];
  availability: Record<PipelineRunner, boolean>;
  cycleAcrossRunners: boolean;
  retryCycles: number;
  attemptIndex: number;
  missingAzureEnv: string[];
  missingRemoteEnv: string[];
  remoteServiceUrl: string;
  remoteServiceSecret: string;
  ffmpegCommandTimeoutSeconds: number;
  compositionHeartbeatSeconds: number;
  pipelineExecutionTimeoutMinutes: number | null;
}> => {
  let config: any = null;
  const envRunner = (process.env.PIPELINE_RUNNER || '').toLowerCase();
  const envPrimary = (envRunner === 'local' || envRunner === 'azure' || envRunner === 'remote')
    ? envRunner
    : null;

  try {
    config = await SystemConfig.findOne()
      .sort({ updatedAt: -1 })
      .select('pipelineRunner pipelineRunnerFallbackOrder pipelineRunnerPinned pipelineServiceUrl pipelineServiceSecret pipelineRetryCycles pipelineCycleAcrossRunners ffmpegCommandTimeoutSeconds compositionHeartbeatSeconds pipelineExecutionTimeoutMinutes');
  } catch (error) {
    console.warn('Failed to load SystemConfig for pipeline runner. Falling back to env.', error);
  }

  const configPrimary =
    config?.pipelineRunner === 'local' ||
    config?.pipelineRunner === 'azure' ||
    config?.pipelineRunner === 'remote'
      ? config.pipelineRunner
      : null;

  const remoteServiceUrl = normalizePipelineServiceUrl(config?.pipelineServiceUrl) || normalizePipelineServiceUrl(process.env.PIPELINE_SERVICE_URL);
  const remoteServiceSecret = String(config?.pipelineServiceSecret || process.env.PIPELINE_SERVICE_SECRET || process.env.WEBHOOK_SECRET || '').trim();
  const autoPrimary: 'local' | 'azure' | 'remote' = remoteServiceUrl ? 'remote' : 'local';
  const effectivePinned = typeof config?.pipelineRunnerPinned === 'boolean'
    ? config.pipelineRunnerPinned
    : pipelineRunnerPinnedFallback;
  const derivedPrimary: 'local' | 'azure' | 'remote' =
    (effectivePinned
      ? ((envPrimary as any) || (configPrimary as any) || autoPrimary)
      : ((configPrimary as any) || (envPrimary as any) || autoPrimary));

  const fallbackOrder = sanitizePipelineRunnerFallbackOrder(config?.pipelineRunnerFallbackOrder);
  const sequence = buildRunnerSequence(derivedPrimary, fallbackOrder);
  const cycleAcrossRunners = sanitizePipelineCycleAcrossRunners(config?.pipelineCycleAcrossRunners, true);
  const retryCycles = sanitizePipelineRetryCycles(config?.pipelineRetryCycles);
  const attemptIndex = cycleAcrossRunners ? Math.max(0, Math.floor(Number(attemptsMade) || 0)) : 0;
  const selectedRunner = pickRunnerForAttempt(derivedPrimary, sequence, attemptIndex) as PipelineRunner;

  const availability: Record<PipelineRunner, boolean> = {
    local: isRunnerAvailable('local'),
    azure: isRunnerAvailable('azure'),
    remote: isRunnerAvailable('remote', { remoteServiceUrl }),
    oracle: true,
  };

  let resolvedRunner = selectedRunner;
  if (!availability[selectedRunner]) {
    const selectedIndex = Math.max(0, sequence.indexOf(selectedRunner));
    let fallback: PipelineRunner | null = null;
    for (let offset = 1; offset < sequence.length; offset += 1) {
      const candidate = sequence[(selectedIndex + offset) % sequence.length] as PipelineRunner;
      if (availability[candidate]) {
        fallback = candidate;
        break;
      }
    }
    if (fallback) {
      resolvedRunner = fallback;
      console.warn(
        `[PipelineWorker] Selected runner "${selectedRunner}" is unavailable. Falling back to "${resolvedRunner}".`
      );
    }
  }

  const cachedAzureAuthFailure = getActiveAzureAuthFailureReason();
  const missingAzureEnv = availability.azure
    ? []
    : Array.from(
        new Set([
          ...getMissingAzureRunnerEnv(),
          ...(cachedAzureAuthFailure ? [`AZURE_AUTH_INVALID:${cachedAzureAuthFailure}`] : []),
        ])
      );
  const missingRemoteEnv = availability.remote ? [] : getMissingRemoteRunnerEnv(config?.pipelineServiceUrl);
  const ffmpegCommandTimeoutSeconds = sanitizeFfmpegCommandTimeoutSeconds(config?.ffmpegCommandTimeoutSeconds);
  const compositionHeartbeatSeconds = sanitizeCompositionHeartbeatSeconds(config?.compositionHeartbeatSeconds);
  const pipelineExecutionTimeoutMinutes = sanitizePipelineExecutionTimeoutMinutes(config?.pipelineExecutionTimeoutMinutes);

  return {
    runner: resolvedRunner,
    targetRunner: selectedRunner,
    primary: derivedPrimary,
    sequence,
    availability,
    cycleAcrossRunners,
    retryCycles,
    attemptIndex,
    missingAzureEnv,
    missingRemoteEnv,
    remoteServiceUrl,
    remoteServiceSecret,
    ffmpegCommandTimeoutSeconds,
    compositionHeartbeatSeconds,
    pipelineExecutionTimeoutMinutes,
  };
};

const updateProgressSafe = async (
  job: BullJob<PipelineJobPayload>,
  progress: number,
  stage: string,
  message?: string
): Promise<void> => {
  try {
    const progressPayload = {
      progress: Math.max(0, Math.min(100, Math.floor(progress))),
      stage,
      message: message || '',
      timestamp: new Date().toISOString(),
    };
    await job.updateProgress(progressPayload);

    const dbJobId = job.data?.jobId;
    if (dbJobId) {
      await JobModel.updateOne(
        { _id: dbJobId },
        { $set: { progress: progressPayload } }
      );
    }
  } catch {
    // Best-effort only
  }
};

const startRuntimeProgressTicker = (
  job: BullJob<PipelineJobPayload>,
  startValue: number,
  maxValue: number,
  intervalMs: number
) => {
  let current = startValue;
  const timer = setInterval(() => {
    if (current >= maxValue) {
      clearInterval(timer);
      return;
    }
    current += 1;
    void updateProgressSafe(job, current, 'pipeline_runtime', 'Processing video');
  }, intervalMs);
  return () => clearInterval(timer);
};

const shouldRequireYouTubeUpload = (settings: Record<string, any>, uploadTargetId?: string): boolean => {
  if (!settings || typeof settings !== 'object') return false;
  if (settings.upload === false) return false;
  return Boolean(
    settings.upload === true ||
    settings.autoUpload === true ||
    settings.autoUploadSchedule === true ||
    settings.scheduleEnabled === true ||
    settings.publishNow === true ||
    // Immediate dashboard runs usually provide a channelId without explicit upload flags.
    (typeof settings.channelId === 'string' && settings.channelId.trim().length > 0) ||
    (typeof uploadTargetId === 'string' && uploadTargetId.trim().length > 0)
  );
};

const resolveYouTubeUploadTarget = (
  settings: Record<string, any>,
  executionJob: Record<string, any>
): string => {
  const primaryChannelId = typeof executionJob?.pipelineConfig?.channelId === 'string' // FIXED: Use canonical persisted job.pipelineConfig.channelId as primary source.
    ? executionJob.pipelineConfig.channelId.trim() // FIXED: Normalize persisted channel id before use.
    : ''; // FIXED: Treat non-string/empty persisted values as unresolved.
  if (primaryChannelId) return primaryChannelId; // FIXED: Stop resolution once canonical job pipeline channel is present.

  const secondaryChannelId = typeof settings?.channelId === 'string' // FIXED: Use runtime settings.channelId only as secondary source.
    ? settings.channelId.trim() // FIXED: Normalize settings channel id before use.
    : ''; // FIXED: Treat non-string/empty settings values as unresolved.
  return secondaryChannelId; // FIXED: Never fall back to legacy youtubeAccountId/accountId fields.
};

const extractPipelineOutputJson = (stdout: string): Record<string, any> | null => {
  const marker = 'PIPELINE_OUTPUT_JSON:';
  const index = stdout.lastIndexOf(marker);
  if (index === -1) return null;
  const tail = stdout.slice(index + marker.length);
  if (!tail.trim()) return null;

  // Robust extraction: parse first balanced JSON object after marker
  // (stdout may contain extra lines after the JSON payload).
  const start = tail.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < tail.length; i++) {
    const ch = tail[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = tail.slice(start, i + 1).trim();
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

const parseBaseUrl = (value: string): string => {
  const cleaned = value.trim();
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return cleaned.replace(/\/+$/, '');
  }
};

const resolveBackendBaseUrl = (): string => {
  const explicit = process.env.BACKEND_URL || '';
  if (explicit.trim()) {
    return parseBaseUrl(explicit);
  }
  const webhookUrl = process.env.WEBHOOK_URL || '';
  if (webhookUrl.trim()) {
    return parseBaseUrl(webhookUrl);
  }
  return '';
};

const uniqueStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const sanitizePayloadValue = (value: any): any => {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizePayloadValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      const sanitized = sanitizePayloadValue(entry);
      if (sanitized !== undefined) {
        out[key] = sanitized;
      }
    }
    return out;
  }
  if (value === undefined || value === null) return undefined;
  return value;
};

const buildMediaFileUrl = (baseUrl: string, filename: string): string => {
  return `${baseUrl}/api/media/file/${encodeURIComponent(filename)}`;
};

const resolveMediaUrlsByIds = async (
  params: {
    userId: string;
    ids: unknown;
    expectedType: 'video' | 'image' | 'thumbnail';
    baseUrl: string;
  }
): Promise<{ urls: string[]; requested: number; resolved: number; invalidIds: number; missing: number }> => {
  const requestedIds = uniqueStringArray(params.ids);
  if (requestedIds.length === 0 || !params.baseUrl) {
    return { urls: [], requested: requestedIds.length, resolved: 0, invalidIds: 0, missing: requestedIds.length };
  }

  const validIds = requestedIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const invalidIds = requestedIds.length - validIds.length;
  if (validIds.length === 0) {
    return {
      urls: [],
      requested: requestedIds.length,
      resolved: 0,
      invalidIds,
      missing: requestedIds.length,
    };
  }

  const mediaDocs = await Media.find({
    _id: { $in: validIds },
    userId: params.userId,
    type: params.expectedType,
  }).select('_id filename');

  const byId = new Map<string, string>();
  for (const doc of mediaDocs) {
    const docId = String(doc._id);
    if (doc.filename) {
      byId.set(docId, buildMediaFileUrl(params.baseUrl, doc.filename));
    }
  }

  const urls = validIds.map((id) => byId.get(id)).filter((url): url is string => Boolean(url));
  const missing = Math.max(0, requestedIds.length - urls.length);
  return {
    urls,
    requested: requestedIds.length,
    resolved: urls.length,
    invalidIds,
    missing,
  };
};

const pipelineWorker = new Worker<PipelineJobPayload>(
  'pipelineQueue',
  async (job: BullJob<PipelineJobPayload>) => {
    const { userId, jobId, settings: rawSettings } = job.data;
    if (job.attemptsMade > 0) {
      console.warn(`[PipelineWorker] Retry detected for job: ${job.id} (attemptsMade=${job.attemptsMade})`);
    }
    const inputAudit = normalizePipelineSettings(rawSettings || {});
    let settings = inputAudit.normalizedSettings;
    console.log(`Processing job ${jobId} for user ${userId}`);

    let isSkipped = false;

    const res = await JobModel.updateOne(
      { _id: jobId, status: 'pending' },
      {
        $set: {
          status: 'processing',
          startedAt: new Date(),
          executionLockedAt: new Date(),
        }
      }
    );
    if (res.modifiedCount === 0) {
      return;
    }
    const lockedJob = await JobModel.findById(jobId);
    if (!lockedJob) return;
    const acceptedYouTubeLimitWarning = Boolean((lockedJob as any)?.acceptedYouTubeLimitWarning);

    if (lockedJob.pipelineConfig) {
      const persistedAudit = normalizePipelineSettings(lockedJob.pipelineConfig as Record<string, any>);
      settings = persistedAudit.normalizedSettings;
    }

    await appendLogSafe(jobId, 'Job is processing...\n');
    await updateProgressSafe(job, 5, 'processing', 'Job accepted by worker');
    if (inputAudit.aliasMappings.length) {
      await appendLogSafe(jobId, `Input alias mappings applied: ${inputAudit.aliasMappings.join(', ')}\n`);
    }
    if (inputAudit.unusedFields.length) {
      await appendLogSafe(jobId, `Input fields currently not used by runtime: ${inputAudit.unusedFields.join(', ')}\n`);
    }
    if (inputAudit.notes.length) {
      await appendLogSafe(jobId, `Input notes: ${inputAudit.notes.join(' | ')}\n`);
    }

    const lockKey = `lock:job:${jobId}`;
    const acquired = await acquireLock(lockKey, 3600); // 1 hour TTL
    if (!acquired) {
      console.warn(`[PipelineWorker] Job ${jobId} is currently being processed by another worker. Throwing error to trigger BullMQ retry.`);
      throw new Error(`Job ${jobId} is locked by another instance.`);
    }
    console.log(`[PipelineWorker] Acquired lock for Job ${jobId} (User: ${userId})`);

    try {
      // 1. Check channel-scoped daily upload limit (10 uploads per IST day)
      if (settings.channelId) {
        const currentIstDayStart = getCurrentUsageDayStartUtc();
        const uploadsInDailyWindow = await getConsumedUploadsLast24hForChannel(userId, settings.channelId);

        const requestedUploads = getRequestedUploadCount(settings.videoCount);
        const limitExceeded = (uploadsInDailyWindow + requestedUploads) > 10;
        const dbJob = await JobModel.findById(jobId);
        const acceptedWarning = Boolean((dbJob as any)?.acceptedYouTubeLimitWarning);

        if (limitExceeded && !acceptedWarning) {
          isSkipped = true;
          await appendLogSafe(jobId, `\nJob rejected due to YouTube daily upload limit (IST day window).\n`, 'failed');
          const limitRejectedJob = await JobModel.findOneAndUpdate(
            { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
            {
              $set: {
                status: 'failed',
                holdConsumed: false,
                holdReleased: true,
                processedVideos: 0,
                errorMessage: 'Skipped due to YouTube daily upload limit (IST day window)',
                errorStage: 'UPLOAD',
                completedAt: new Date(),
                result: {
                  success: false,
                  stage: 'UPLOAD',
                  message: 'Skipped due to YouTube daily upload limit (IST day window)',
                  skippedAt: new Date().toISOString(),
                },
                progress: {
                  progress: 100,
                  stage: 'failed',
                  message: 'YouTube daily upload limit reached',
                  timestamp: new Date().toISOString(),
                },
              },
            },
            { returnDocument: 'after' }
          );
          if (limitRejectedJob) {
            await releaseReservedCredits(userId, requestedUploads).catch(console.error);
          }

          // Notify user only once per limit window
          const u = await User.findById(userId);
          if (u) {
            const ch = u.youtubeChannels.find(c => c.channelId === settings.channelId);
            if (ch) {
              const lastWarning = ch.lastLimitWarningSentAt;
              if (!lastWarning || lastWarning.getTime() < currentIstDayStart.getTime()) {
                await User.findOneAndUpdate(
                  { _id: userId, 'youtubeChannels.channelId': settings.channelId },
                  { $set: { 'youtubeChannels.$.lastLimitWarningSentAt': new Date() } }
                );
                await notifyUser(u, 'Daily Upload Limit Reached', '⚠️ YouTube daily upload limit reached for this channel.').catch(console.error);
              }
            }
          }
          return;
        }

        if (limitExceeded && acceptedWarning) {
          await appendLogSafe(jobId, '[UPLOAD_LIMIT_WARNING] User accepted daily upload limit warning and chose to continue.\n');
        }
      }

      // 2. Load backend-prepared content from DB (execution-only pipeline)
      await updateProgressSafe(job, 12, 'content_load', 'Loading prepared content');
      const dbJobForExecution = await JobModel.findById(jobId);
      if (!dbJobForExecution) {
        throw new Error(`Job ${jobId} not found`);
      }
      if (dbJobForExecution.youtubeVideoId) {
        await appendLogSafe(jobId, 'Job already has youtubeVideoId. Skipping duplicate execution.\n', 'success');
        await JobModel.findByIdAndUpdate(jobId, {
          status: 'success',
          completedAt: new Date(),
          errorMessage: '',
          errorStage: undefined as any,
          progress: {
            progress: 100,
            stage: 'completed',
            message: 'Job already completed earlier',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      let preparedContent = Array.isArray(dbJobForExecution.preparedContent) ? dbJobForExecution.preparedContent : [];
      const hasValidContent = Array.isArray(dbJobForExecution.preparedContent)
        && dbJobForExecution.preparedContent.length > 0
        && dbJobForExecution.preparedContent.some((item: any) => item?.script?.length > 10); // FIXED: Treat cached content as valid only when at least one item has a meaningful script payload.
      if (!hasValidContent) {
        await appendLogSafe(jobId, 'No prepared content found. Generating content in background worker...\n');
        await updateProgressSafe(job, 18, 'content_generation', 'Generating structured content');

        const promptDoc = await Prompt.findById(dbJobForExecution.promptId);
        if (!promptDoc) {
          const err: any = new Error('Prompt not found for background content generation.');
          err.stage = 'CONTENT_GENERATION';
          throw err;
        }

        const generationTopic = String((dbJobForExecution as any).chosenSubTopic || (dbJobForExecution as any).topic || promptDoc.user_prompt || '').trim(); // FIXED: Prefer chosen sub-topic persisted on job for downstream content generation.
        const generationPrompt = String((dbJobForExecution as any).generatedPrompt || promptDoc.gemini_prompt || generationTopic).trim(); // FIXED: Prefer job-level prompt built from chosen sub-topic.
        const generationInput: any = {
          topic: generationTopic,
          prompt: generationPrompt,
          videoCount: settings.videoCount || 1,
        };
        if (typeof settings.targetDuration === 'number') generationInput.targetDuration = settings.targetDuration;
        if (typeof settings.duration === 'number') generationInput.duration = settings.duration;
        if (typeof settings.storyMode === 'boolean') generationInput.storyMode = settings.storyMode;
        if (typeof settings.currentPart === 'number') generationInput.currentPart = settings.currentPart;
        if (typeof settings.recapEnabled === 'boolean') generationInput.recapEnabled = settings.recapEnabled;
        if (typeof settings.ctaEnabled === 'boolean') generationInput.ctaEnabled = settings.ctaEnabled;
        if (typeof settings.lastPrompt === 'string') generationInput.lastPrompt = settings.lastPrompt;
        if (settings.templateConfig && typeof settings.templateConfig === 'object') {
          generationInput.templateConfig = settings.templateConfig;
        }

        const generated = await generateContent(generationInput);
        console.log(`[PipelineWorker] Model used for content generation:`, generationInput);
        await appendLogSafe(jobId, `[PipelineWorker] Model used for content generation: ${JSON.stringify(generationInput)}\n`);
        console.log(`[PipelineWorker] Prompt generated:`, generated.prompt);
        await appendLogSafe(jobId, `[PipelineWorker] Prompt generated: ${generated.prompt}\n`);
        console.log(`[PipelineWorker] Generated script:`, generated.script);
        await appendLogSafe(jobId, `[PipelineWorker] Generated script: ${JSON.stringify(generated.script)}\n`);
        if (generated.captions) {
          console.log(`[PipelineWorker] Generated captions:`, generated.captions);
          await appendLogSafe(jobId, `[PipelineWorker] Generated captions: ${JSON.stringify(generated.captions)}\n`);
        }
        if (generated.title) {
          console.log(`[PipelineWorker] Generated title:`, generated.title);
          await appendLogSafe(jobId, `[PipelineWorker] Generated title: ${generated.title}\n`);
        }
        if (generated.description) {
          console.log(`[PipelineWorker] Generated description:`, generated.description);
          await appendLogSafe(jobId, `[PipelineWorker] Generated description: ${generated.description}\n`);
        }
        if (generated.hashtags) {
          console.log(`[PipelineWorker] Generated hashtags:`, generated.hashtags);
          await appendLogSafe(jobId, `[PipelineWorker] Generated hashtags: ${JSON.stringify(generated.hashtags)}\n`);
        }
        if (generated.metadata) {
          console.log(`[PipelineWorker] Generated metadata:`, generated.metadata);
          await appendLogSafe(jobId, `[PipelineWorker] Generated metadata: ${JSON.stringify(generated.metadata)}\n`);
        }
        if (generated.preparedContent) {
          console.log(`[PipelineWorker] Generated preparedContent:`, generated.preparedContent);
          await appendLogSafe(jobId, `[PipelineWorker] Generated preparedContent: ${JSON.stringify(generated.preparedContent)}\n`);
        }
        console.log(`[PipelineWorker] Saving generated content to DB for job ${jobId}`);
        const validStructuredScript = Array.isArray(generated.script)
          && generated.script.every(
            (part) => Array.isArray(part) && part.every((line) => line && typeof line.text === 'string' && line.text.trim().length > 0)
          );
        if (!validStructuredScript) {
          const err: any = new Error('Generated script is invalid in background worker.');
          err.stage = 'CONTENT_GENERATION';
          throw err;
        }

        await JobModel.findByIdAndUpdate(jobId, {
          generatedPrompt: generated.prompt,
          generatedScript: generated.script,
          captions: generated.captions,
          title: generated.title,
          description: generated.description,
          hashtags: generated.hashtags,
          generatedScenes: generated.scenes,
          generatedMetadata: generated.metadata,
          preparedContent: generated.preparedContent,
        });

        preparedContent = generated.preparedContent as any[];
          console.log(`[PipelineWorker] Content generation completed for job ${jobId}. Items: ${preparedContent.length}`);
        await appendLogSafe(jobId, `Background content generation completed with ${preparedContent.length} item(s).\n`);
          await appendLogSafe(jobId, `[PipelineWorker] Content generation completed for job ${jobId}. Items: ${preparedContent.length}\n`);
        await updateProgressSafe(job, 30, 'content_generation', 'Content generation completed');
      }
      const executionJob = (await JobModel.findById(jobId)) || dbJobForExecution;
      const firstPreparedItem = (preparedContent[0] && typeof preparedContent[0] === 'object')
        ? (preparedContent[0] as Record<string, any>)
        : {};
      const generatedScript = Array.isArray(executionJob.generatedScript?.[0])
        ? (executionJob.generatedScript?.[0] || [])
        : (executionJob.generatedScript || []);
      const payloadScript = Array.isArray(generatedScript) && generatedScript.length > 0
        ? generatedScript
        : (Array.isArray(firstPreparedItem.script) ? firstPreparedItem.script : []);
      const payloadCaptions = Array.isArray(executionJob.captions?.[0])
        ? (executionJob.captions?.[0] || [])
        : (Array.isArray(executionJob.captions) ? executionJob.captions : []);
      const fallbackCaptions = Array.isArray(firstPreparedItem.captions) ? firstPreparedItem.captions : [];
      const preparedSearchQueries = Array.isArray((firstPreparedItem as any)?.searchQueries)
        ? (firstPreparedItem as any).searchQueries
        : [];
      const generatedSearchQueries = Array.isArray((executionJob as any)?.generatedMetadata?.[0]?.searchQueries)
        ? (executionJob as any).generatedMetadata[0].searchQueries
        : [];
      const payloadSearchQueries = (preparedSearchQueries.length > 0 ? preparedSearchQueries : generatedSearchQueries)
        .filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
        .map((item: string) => item.trim());
      const payloadMetadata = payloadSearchQueries.length > 0
        ? [{ searchQueries: payloadSearchQueries }]
        : [];
      if (!Array.isArray(payloadScript) || payloadScript.length === 0) {
        const err: any = new Error('Prepared script is missing or empty. Cannot dispatch pipeline execution.');
        err.stage = 'CONTENT_GENERATION';
        throw err;
      }
      const generatedPrompt = executionJob.generatedPrompt || '';
      const backendBaseUrl = resolveBackendBaseUrl();
      if (!backendBaseUrl) {
        await appendLogSafe(
          jobId,
          `${JSON.stringify({ event: 'media_resolution', level: 'warn', reason: 'backend_url_missing' })}\n`
        );
      } else if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/i.test(backendBaseUrl)) {
        await appendLogSafe(
          jobId,
          `${JSON.stringify({ event: 'media_resolution', level: 'warn', reason: 'backend_url_localhost_in_production', backendBaseUrl })}\n`
        );
      }

      const resolvedCustomVideos = await resolveMediaUrlsByIds({
        userId,
        ids: executionJob.customVideoIds || settings.customVideoIds || [],
        expectedType: 'video',
        baseUrl: backendBaseUrl,
      });
      const resolvedCustomImages = await resolveMediaUrlsByIds({
        userId,
        ids: executionJob.customImageIds || settings.customImageIds || [],
        expectedType: 'image',
        baseUrl: backendBaseUrl,
      });
      const resolvedCustomThumbnail = await resolveMediaUrlsByIds({
        userId,
        ids: executionJob.customThumbnailId ? [executionJob.customThumbnailId] : (settings.customThumbnailId ? [settings.customThumbnailId] : []),
        expectedType: 'thumbnail',
        baseUrl: backendBaseUrl,
      });

      await appendLogSafe(
        jobId,
        `${JSON.stringify({
          event: 'media_resolution',
          customVideos: {
            requested: resolvedCustomVideos.requested,
            resolved: resolvedCustomVideos.resolved,
            invalidIds: resolvedCustomVideos.invalidIds,
            missing: resolvedCustomVideos.missing,
          },
          customImages: {
            requested: resolvedCustomImages.requested,
            resolved: resolvedCustomImages.resolved,
            invalidIds: resolvedCustomImages.invalidIds,
            missing: resolvedCustomImages.missing,
          },
          customThumbnail: {
            requested: resolvedCustomThumbnail.requested,
            resolved: resolvedCustomThumbnail.resolved,
            invalidIds: resolvedCustomThumbnail.invalidIds,
            missing: resolvedCustomThumbnail.missing,
          },
        })}\n`
      );
      await updateProgressSafe(job, 40, 'payload_build', 'Media resolution and payload build');

      const configuredMaxWordsPerCaption = Number((settings.templateConfig as any)?.maxWordsPerCaption);
      const configuredCaptionAnimationRaw = String((settings.templateConfig as any)?.captionAnimation || '').trim().toLowerCase();
      const configuredCaptionAnimation =
        configuredCaptionAnimationRaw === 'slide_left' ||
        configuredCaptionAnimationRaw === 'slide_right' ||
        configuredCaptionAnimationRaw === 'pop' ||
        configuredCaptionAnimationRaw === 'none' ||
        configuredCaptionAnimationRaw === 'fade'
          ? configuredCaptionAnimationRaw
          : 'fade';

      const payloadVideoConfig = sanitizePayloadValue({
        ...(executionJob.pipelineConfig || settings || {}),
        customVideoUrls: resolvedCustomVideos.urls,
        customImageUrls: resolvedCustomImages.urls,
        customThumbnailUrl: resolvedCustomThumbnail.urls[0] || '',
        templateConfig: {
          fontStyle: settings.templateConfig?.fontStyle || 'Anton',
          subtitleColor: settings.templateConfig?.subtitleColor || '#FFFFFF',
          captionPosition: (settings.templateConfig as any)?.captionPosition || 'bottom',
          captionAnimation: configuredCaptionAnimation,
          maxWordsPerCaption: Number.isFinite(configuredMaxWordsPerCaption)
            ? Math.max(1, Math.min(8, Math.floor(configuredMaxWordsPerCaption)))
            : 4,
        },
        targetDuration: settings.targetDuration || settings.duration || 40,
        ctaEnabled: !!settings.ctaEnabled,
        recapEnabled: !!settings.recapEnabled,
        storyMode: !!settings.storyMode,
        currentPart: settings.currentPart || 1,
        voiceName: (settings.voices && settings.voices[0]) || '',
      });

      const uploadTargetChannelId = resolveYouTubeUploadTarget(
        settings as Record<string, any>,
        executionJob as Record<string, any>
      );
      await appendLogSafe(jobId, `[CHANNEL_CHECK] resolved uploadTargetChannelId=${uploadTargetChannelId || '(empty)'}\n`); // FIXED: Add explicit channel resolution trace for end-to-end debugging.

      const pipelinePayload = sanitizePayloadValue({
        jobId,
        mode: String((settings as any)?.mode || (settings as any)?.executionMode || process.env.PIPELINE_DEFAULT_MODE || 'full')
          .trim()
          .toLowerCase() === 'prepared'
          ? 'prepared'
          : 'full',
        topic: String((executionJob as any)?.topic || (firstPreparedItem as any)?.topic || '').trim(),
        script: payloadScript,
        captions: payloadCaptions.length > 0 ? payloadCaptions : fallbackCaptions,
        metadata: payloadMetadata,
        videoConfig: payloadVideoConfig,
        targetDuration: settings.targetDuration || settings.duration || 40,
        ctaEnabled: !!settings.ctaEnabled,
        recapEnabled: !!settings.recapEnabled,
        youtube: {
          title: executionJob.title || String(firstPreparedItem.title || ''),
          description: executionJob.description || String(firstPreparedItem.description || ''),
          hashtags: Array.isArray(executionJob.hashtags) && executionJob.hashtags.length > 0
            ? executionJob.hashtags
            : (Array.isArray(firstPreparedItem.hashtags) ? firstPreparedItem.hashtags : []),
          accountId: uploadTargetChannelId,
        },
      });
      if (!Array.isArray(pipelinePayload?.script) || pipelinePayload.script.length === 0) {
        const err: any = new Error('pipelinePayload.script is required and must be a non-empty array.');
        err.stage = 'CONTENT_GENERATION';
        throw err;
      }
      if (!pipelinePayload?.youtube || typeof pipelinePayload.youtube !== 'object') {
        const err: any = new Error('pipelinePayload.youtube is required.');
        err.stage = 'CONTENT_GENERATION';
        throw err;
      }
      await appendLogSafe(
        jobId,
        `${JSON.stringify({
          event: 'payload_creation',
          scriptLines: pipelinePayload.script.length,
          captionLines: Array.isArray(pipelinePayload.captions) ? pipelinePayload.captions.length : 0,
          hasCustomVideoUrls: Array.isArray(pipelinePayload.videoConfig?.customVideoUrls) && pipelinePayload.videoConfig.customVideoUrls.length > 0,
          hasCustomImageUrls: Array.isArray(pipelinePayload.videoConfig?.customImageUrls) && pipelinePayload.videoConfig.customImageUrls.length > 0,
          hasCustomThumbnailUrl: Boolean(pipelinePayload.videoConfig?.customThumbnailUrl),
        })}\n`
      );

      // 2b. Safely compute Story Mode state exactly before passing to container
      if (settings.storyMode && settings.storyId) {
        const progress = await StoryProgress.findOne({ userId, storyId: settings.storyId });
        const hasCurrentPartInput = typeof settings.currentPart === 'number' && Number.isFinite(settings.currentPart);
        const hasLastPromptInput = typeof settings.lastPrompt === 'string' && settings.lastPrompt.length > 0;

        if (progress) {
          if (!hasCurrentPartInput) {
            settings.currentPart = progress.currentPart;
          }
          if (!hasLastPromptInput) {
            settings.lastPrompt = progress.lastPrompt;
          }
        } else {
          if (!hasCurrentPartInput) {
            settings.currentPart = 1;
          }
          if (!hasLastPromptInput) {
            settings.lastPrompt = '';
          }
        }

        // Ensure recap is strictly disabled for Part 1 regardless of frontend payload
        if ((settings.currentPart || 1) <= 1) {
            if (settings.recapEnabled) {
              await appendLogSafe(jobId, 'recapEnabled was provided but disabled for story part 1.\n');
            }
            settings.recapEnabled = false;
        }

        // FIXED: Keep already-constructed payload videoConfig synchronized with story state corrections.
        (payloadVideoConfig as any).currentPart = settings.currentPart || 1;
        (payloadVideoConfig as any).lastPrompt = settings.lastPrompt || '';
        (payloadVideoConfig as any).recapEnabled = !!settings.recapEnabled;
        (payloadVideoConfig as any).storyMode = !!settings.storyMode;
        (pipelinePayload as any).videoConfig = payloadVideoConfig;
        (pipelinePayload as any).recapEnabled = !!settings.recapEnabled;

        await appendLogSafe(jobId, `
Proceeding with Story ${settings.storyId} - Episode ${settings.currentPart}...
`, 'processing');
      }

      // 3. Ensure valid YouTube token only if this run requires upload.
      const requiresUpload = shouldRequireYouTubeUpload(settings as Record<string, any>, uploadTargetChannelId);
      await appendLogSafe(
        jobId,
        `${JSON.stringify({
          event: 'upload_decision',
          requiresUpload,
          uploadTargetChannelId,
          uploadFlag: (settings as any).upload,
          autoUpload: (settings as any).autoUpload,
          publishNow: (settings as any).publishNow,
        })}\n`
      );
      let youtubeToken = '';
      let encryptedYoutubeTokenJson = ''; // FIXED: Carry full channel-specific OAuth token JSON for selected channel.
      let scopedTokenPayload = ''; // FIXED: Preserve raw token JSON for local runner fallback.
      if (requiresUpload) {
        if (!uploadTargetChannelId) {
          const err: any = new Error('Upload requested but no YouTube channel/account id was resolved.');
          err.stage = 'UPLOAD';
          throw err;
        }
        await updateProgressSafe(job, 45, 'token_validation', 'Validating YouTube token');
        try {
          youtubeToken = (await ensureValidYouTubeToken(uploadTargetChannelId, userId)).accessToken;
        } catch (error: any) {
          error.stage = 'TOKEN';
          throw error;
        }
        if (!youtubeToken) {
          const err: any = new Error('Failed to obtain a valid YouTube token');
          err.stage = 'TOKEN';
          throw err;
        }

        const tokenUser = await User.findById(userId); // FIXED: Reload user after token validation to read latest channel token state.
        const selectedChannel = tokenUser?.youtubeChannels?.find((channel) => channel.channelId === uploadTargetChannelId); // FIXED: Strictly select the exact requested channel token.
        if (!selectedChannel?.tokens?.access_token) { // FIXED: Prevent dispatch when selected channel tokens are unavailable.
          const err: any = new Error(`Selected YouTube channel token not found for channelId=${uploadTargetChannelId}`); // FIXED: Emit clear token/channel mismatch error.
          err.stage = 'TOKEN'; // FIXED: Keep failure stage compatible with existing error handling.
          throw err; // FIXED: Fail fast instead of risking upload with stale token context.
        }

        scopedTokenPayload = JSON.stringify({ // FIXED: Build channel-scoped token payload for Python uploader.
          token: selectedChannel.tokens.access_token || '', // FIXED: Provide access token for immediate authenticated uploads.
          refresh_token: selectedChannel.tokens.refresh_token || '', // FIXED: Provide refresh token tied to the exact channel.
          expiry_date: selectedChannel.tokens.expiry_date || undefined, // FIXED: Preserve expiry metadata for refresh logic.
          token_uri: 'https://oauth2.googleapis.com/token', // FIXED: Include token endpoint expected by OAuth credential helpers.
          client_id: process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '', // FIXED: Include OAuth client id required for refresh.
          client_secret: process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '', // FIXED: Include OAuth client secret required for refresh.
          scopes: ['https://www.googleapis.com/auth/youtube.upload'], // FIXED: Scope payload to upload permission.
        });
        encryptedYoutubeTokenJson = encrypt(scopedTokenPayload); // FIXED: Encrypt channel-specific token JSON before passing to runtime.
      } else {
        await appendLogSafe(jobId, 'Upload not requested for this job. Skipping YouTube token validation.\n');
        await updateProgressSafe(job, 45, 'token_validation', 'Upload disabled, token validation skipped');
      }

      // 4. Trigger pipeline runner (GitHub Actions or Azure Container Apps Job)
      const runnerSelection = await resolvePipelineRunner(job.attemptsMade || 0);
      const pipelineRunner = runnerSelection.runner;
      const requestedVideosForTimeout = getRequestedUploadCount((settings as any)?.videoCount || 1);
      const effectivePipelineExecutionTimeoutMinutes = sanitizePipelineExecutionTimeoutMinutes(
        (settings as any)?.pipelineExecutionTimeoutMinutes ?? runnerSelection.pipelineExecutionTimeoutMinutes
      );
      const effectivePipelineExecutionTimeoutMs = resolvePipelineExecutionTimeoutMs(
        effectivePipelineExecutionTimeoutMinutes,
        requestedVideosForTimeout
      );
      const effectiveFfmpegCommandTimeoutSeconds = sanitizeFfmpegCommandTimeoutSeconds(
        (settings as any)?.ffmpegCommandTimeoutSeconds ?? runnerSelection.ffmpegCommandTimeoutSeconds
      );
      const effectiveCompositionHeartbeatSeconds = sanitizeCompositionHeartbeatSeconds(
        (settings as any)?.compositionHeartbeatSeconds ?? runnerSelection.compositionHeartbeatSeconds
      );
      await appendLogSafe(
        jobId,
        `${JSON.stringify({
          event: 'runner_selection',
          attemptsMade: job.attemptsMade || 0,
          selectedRunner: pipelineRunner,
          targetRunner: runnerSelection.targetRunner,
          primaryRunner: runnerSelection.primary,
          runnerSequence: runnerSelection.sequence,
          cycleAcrossRunners: runnerSelection.cycleAcrossRunners,
          retryCycles: runnerSelection.retryCycles,
          attemptIndex: runnerSelection.attemptIndex,
          runnerAvailability: runnerSelection.availability,
          missingAzureEnv: runnerSelection.missingAzureEnv,
          missingRemoteEnv: runnerSelection.missingRemoteEnv,
          ffmpegCommandTimeoutSeconds: effectiveFfmpegCommandTimeoutSeconds,
          compositionHeartbeatSeconds: effectiveCompositionHeartbeatSeconds,
          pipelineExecutionTimeoutMinutes: effectivePipelineExecutionTimeoutMinutes,
          pipelineExecutionTimeoutMs: effectivePipelineExecutionTimeoutMs,
        })}\n`
      );

      if (!runnerSelection.availability[pipelineRunner]) {
        const localRuntime = resolveLocalPythonRuntime();
        const diagnostics = [
          !localRuntime.available
            ? `Local runtime checked: ${localRuntime.candidates.join(', ')}`
            : '',
          runnerSelection.missingAzureEnv.length > 0
            ? `Missing Azure runner config: ${runnerSelection.missingAzureEnv.join(', ')}`
            : '',
          runnerSelection.missingRemoteEnv.length > 0
            ? `Missing remote runner config: ${runnerSelection.missingRemoteEnv.join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join(' | ');
        const err: any = new Error(
          `No available pipeline runner. Availability=${JSON.stringify(runnerSelection.availability)}${
            diagnostics
              ? ` | ${diagnostics}`
              : ''
          }`
        );
        err.stage = 'RENDER';
        err.nonRetryable = true;
        throw err;
      }

      const dispatchLockKey = `pipeline:dispatch:${jobId}:${job.attemptsMade || 0}`;
      const dispatchLock = await (connection as any).set(dispatchLockKey, String(Date.now()), 'NX', 'EX', 24 * 60 * 60);
      if (dispatchLock !== 'OK') {
        await appendLogSafe(
          jobId,
          `${JSON.stringify({ event: 'dispatch_skip', reason: 'idempotency_lock_exists', jobId, attemptsMade: job.attemptsMade || 0 })}\n`,
          'processing'
        );
        return;
      }

      // Ensure startedAt and processing state is explicitly set right before launching pipeline worker
      // Although we atomically lock it above, we refresh it here to act as the official timer start
      await JobModel.findByIdAndUpdate(jobId, { status: 'processing', startedAt: new Date() });
      await appendLogSafe(jobId, 'Job is running in pipeline...\n', 'processing');
      await updateProgressSafe(job, 55, 'dispatch', 'Dispatching pipeline runtime');

      await JobModel.updateOne(
        { _id: jobId },
        {
          $set: {
            'result.dispatch.runner': pipelineRunner,
            'result.dispatch.targetRunner': runnerSelection.targetRunner,
            'result.dispatch.primaryRunner': runnerSelection.primary,
            'result.dispatch.sequence': runnerSelection.sequence,
            'result.dispatch.ffmpegCommandTimeoutSeconds': effectiveFfmpegCommandTimeoutSeconds,
            'result.dispatch.compositionHeartbeatSeconds': effectiveCompositionHeartbeatSeconds,
            'result.dispatch.pipelineExecutionTimeoutMinutes': effectivePipelineExecutionTimeoutMinutes,
            'result.dispatch.pipelineExecutionTimeoutMs': effectivePipelineExecutionTimeoutMs,
            'result.dispatch.selectedAt': new Date().toISOString(),
            'result.dispatch.azureJobName': pipelineRunner === 'azure' ? String(process.env.AZURE_JOB_NAME || '').trim() : '',
          },
        }
      );

      // We do NOT pass YOUTUBE_TOKEN as a plain environment variable in the clear.
      // Instead, we pass it encrypted so that it doesn't leak into Azure/Docker logs.
      // We will encrypt the token using the same ENCRYPTION_KEY used for DB storage.
      const encryptedYoutubeToken = youtubeToken ? encrypt(youtubeToken) : '';

      // Setup payload configuring environment variables for the container run
      // Production hardening: always execute full video generation runtime.
      const runtimeMode = 'full';
      const useLocalTokenJson = pipelineRunner === 'local' && requiresUpload && scopedTokenPayload;
      const envVars = [
        { name: "USER_ID", value: userId },
        { name: "PIPELINE_PAYLOAD", value: JSON.stringify(pipelinePayload) },
        { name: "SETTINGS", value: JSON.stringify(payloadVideoConfig) },
        { name: "RUN_MODE", value: runtimeMode },
        { name: "YOUTUBE_TOKEN_JSON_ENCRYPTED", value: useLocalTokenJson ? '' : encryptedYoutubeTokenJson }, // FIXED: Use plain token JSON for local runner to avoid decryption mismatches.
        { name: "YOUTUBE_TOKEN_ENCRYPTED", value: useLocalTokenJson ? '' : encryptedYoutubeToken },
        ...(useLocalTokenJson ? [{ name: "YOUTUBE_TOKEN_JSON", value: scopedTokenPayload }] : []),
        { name: "ENCRYPTION_KEY", value: process.env.ENCRYPTION_KEY || "" },
        { name: "UPLOAD", value: requiresUpload ? "true" : "false" },
        { name: "JOB_ID", value: jobId },
        { name: "JULES_API_URL", value: process.env.JULES_API_URL || "" },
        { name: "JULES_API_KEY", value: process.env.JULES_API_KEY || "" },
        { name: "GEMINI_API_KEY", value: process.env.GEMINI_API_KEY || "" },
        { name: "FFMPEG_COMMAND_TIMEOUT_SECONDS", value: String(effectiveFfmpegCommandTimeoutSeconds) },
        { name: "COMPOSITION_HEARTBEAT_SECONDS", value: String(effectiveCompositionHeartbeatSeconds) },
        { name: "PIPELINE_EXECUTION_TIMEOUT_MS", value: String(effectivePipelineExecutionTimeoutMs) },
        { name: "PIPELINE_TIMEOUT_SECONDS", value: String(Math.max(30, Math.floor(effectivePipelineExecutionTimeoutMs / 1000))) },
        { name: "GEMINI_AUDIO_ENABLED", value: "true" },
        { name: "GEMINI_AUDIO_ONLY", value: "true" },
        { name: "FORCE_GOOGLE_AUDIO_ONLY", value: "true" },
        { name: "GEMINI_AUDIO_MODEL", value: process.env.GEMINI_AUDIO_MODEL || "gemini-2.5-flash-native-audio-latest" },
        { name: "GEMINI_AUDIO_SAMPLE_RATE", value: process.env.GEMINI_AUDIO_SAMPLE_RATE || "24000" },
        { name: "ALLOW_SILENT_AUDIO_FALLBACK", value: "false" },
        { name: "WEBHOOK_SECRET", value: process.env.WEBHOOK_SECRET || "" },
        { name: "WEBHOOK_URL", value: process.env.WEBHOOK_URL || "" },
        { name: "BACKEND_URL", value: process.env.BACKEND_URL || "" },
      ];

      if (pipelineRunner === 'remote') {
        await appendLogSafe(jobId, `\nDispatching remote pipeline service for job ${jobId}...\n`);
        const remoteResult = await triggerRemotePipeline({
          jobId,
          userId,
          envVars,
          baseUrlOverride: runnerSelection.remoteServiceUrl,
          authSecretOverride: runnerSelection.remoteServiceSecret,
        });
        await appendLogSafe(jobId, `\nRemote pipeline accepted: ${remoteResult.message}\n`);
        return;
      }

      if (pipelineRunner === 'oracle') {
        await appendLogSafe(jobId, `\nDispatching Oracle Cloud worker for job ${jobId}...\n`);
        const oracleResult = await triggerOracleJob(envVars);
        await JobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              'result.dispatch.runner': 'oracle',
              'result.dispatch.oracleInstanceId': oracleResult.instanceId || 'oracle-worker',
            },
          }
        );
        await appendLogSafe(jobId, `\nOracle Cloud worker accepted: ${oracleResult.message}\n`);
        return;
      }

      if (pipelineRunner === 'local') {
        await appendLogSafe(jobId, `\nDispatching local pipeline process for job ${jobId}...\n`);
        const stopTicker = startRuntimeProgressTicker(job, 56, 88, 8000);
        let result;
        try {
          try {
            result = await triggerLocalPipeline(envVars, undefined, {
              timeoutMs: effectivePipelineExecutionTimeoutMs,
            });
          } catch (localLaunchError: any) {
            const launchError: any = new Error(
              localLaunchError?.code === 'ETIMEDOUT'
                ? `Local pipeline timed out after ${Math.round(effectivePipelineExecutionTimeoutMs / 1000)}s.`
                :
              localLaunchError?.code === 'ENOENT'
                ? 'Local pipeline runtime is unavailable: Python executable not found. Configure PIPELINE_PYTHON_CMD or install Python on worker host.'
                : `Failed to start local pipeline process: ${String(localLaunchError?.message || localLaunchError || 'unknown error')}`
            );
            launchError.stage = 'RENDER';
            launchError.nonRetryable = localLaunchError?.code === 'ENOENT' || localLaunchError?.code === 'ETIMEDOUT';
            launchError.stderrTail = String(localLaunchError?.message || localLaunchError || '');
            throw launchError;
          }
        } finally {
          stopTicker();
        }
        const stdoutTail = (result.stdout || '').slice(-2000);
        const stderrTail = (result.stderr || '').slice(-2000);
        const outputJson = extractPipelineOutputJson(result.stdout || '');
        if (stdoutTail) {
          await appendLogSafe(jobId, `\n[LocalPipeline][stdout-tail]\n${stdoutTail}\n`);
        }
        if (stderrTail) {
          await appendLogSafe(jobId, `\n[LocalPipeline][stderr-tail]\n${stderrTail}\n`);
        }
        if (!result.success) {
          const err: any = new Error(`Local pipeline process failed with exit code ${result.exitCode ?? 'unknown'}`);
          err.stderrTail = stderrTail;
          err.stdoutTail = stdoutTail;
          err.stage = 'RENDER';
          throw err;
        }
        await appendLogSafe(jobId, `\nLocal pipeline process finished.\n`);
        await updateProgressSafe(job, 90, 'pipeline_runtime', 'Pipeline runtime finished');

        const outputVideoUrl = String(
          outputJson?.videoUrl ||
          outputJson?.result?.videoUrl ||
          outputJson?.youtube?.videoUrl ||
          ''
        ).trim();
        const outputYoutubeVideoId = String(
          outputJson?.youtubeVideoId ||
          outputJson?.result?.youtubeVideoId ||
          outputJson?.youtube?.youtubeVideoId ||
          ''
        ).trim();
        const requestedUploads = Math.max(1, Number(settings.videoCount || 1));
        const successfulUploadsHintRaw = Number(
          outputJson?.successfulUploads ??
          outputJson?.result?.successfulUploads ??
          outputJson?.processedVideos ??
          outputJson?.result?.processedVideos
        );
        const successfulUploads = Number.isFinite(successfulUploadsHintRaw)
          ? Math.max(0, Math.min(requestedUploads, Math.floor(successfulUploadsHintRaw)))
          : 0;
        const uploadConfirmed = !requiresUpload || Boolean(
          outputYoutubeVideoId ||
          (outputVideoUrl && /^https?:\/\//i.test(outputVideoUrl))
        );
        const consumeCountOnFailedUpload = acceptedYouTubeLimitWarning ? requestedUploads : successfulUploads;
        const releaseCountOnFailedUpload = Math.max(0, requestedUploads - consumeCountOnFailedUpload);
        const consumeCountOnSuccess = successfulUploads > 0 ? successfulUploads : requestedUploads;
        const releaseCountOnSuccess = Math.max(0, requestedUploads - consumeCountOnSuccess);

        if (!uploadConfirmed) {
          const failedLocal = await JobModel.findOneAndUpdate(
            { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
            {
              $set: {
                status: 'failed',
                completedAt: new Date(),
                holdConsumed: consumeCountOnFailedUpload > 0,
                holdReleased: releaseCountOnFailedUpload > 0,
                error: 'Upload failed or was skipped.',
                errorMessage: 'Upload failed or was skipped.',
                errorStage: 'UPLOAD',
                result: outputJson || { success: false },
                processedVideos: consumeCountOnFailedUpload,
              },
            },
            { returnDocument: 'after' }
          );
          if (failedLocal) {
            if (consumeCountOnFailedUpload > 0) {
              await consumeReservedCredits(userId, consumeCountOnFailedUpload).catch(console.error);
            }
            if (releaseCountOnFailedUpload > 0) {
              await releaseReservedCredits(userId, releaseCountOnFailedUpload).catch(console.error);
            }
            await appendLogSafe(jobId, `${JSON.stringify({ event: 'local_completion_failed_upload', output: outputJson || {} })}\n`, 'failed');
            await updateProgressSafe(job, 99, 'failed', 'Job failed');
          }
          return;
        }

        const finalized = await JobModel.findOneAndUpdate(
          { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
          {
            $set: {
              status: 'success',
              completedAt: new Date(),
              holdConsumed: consumeCountOnSuccess > 0,
              holdReleased: releaseCountOnSuccess > 0,
              errorMessage: '',
              errorStage: undefined as any,
              result: outputJson || { success: true },
              processedVideos: consumeCountOnSuccess,
            },
          },
          { returnDocument: 'after' }
        );
        if (finalized) {
          if (consumeCountOnSuccess > 0) {
            await consumeReservedCredits(userId, consumeCountOnSuccess).catch(console.error);
          }
          if (releaseCountOnSuccess > 0) {
            await releaseReservedCredits(userId, releaseCountOnSuccess).catch(console.error);
          }
          const chosenSubTopic = String((finalized as any).chosenSubTopic || '').trim(); // FIXED: Read selected sub-topic from finalized job.
          if (chosenSubTopic) {
            const topicUser = await User.findById(userId); // FIXED: Load user to update recent topic memory after successful upload.
            if (topicUser) {
              const previousTopics = Array.isArray((topicUser as any).recentTopics)
                ? (topicUser as any).recentTopics.map((topic: unknown) => String(topic || '').trim()).filter(Boolean)
                : [];
              previousTopics.push(chosenSubTopic); // FIXED: Append successful sub-topic to user history.
              (topicUser as any).recentTopics = previousTopics.slice(-100); // FIXED: Retain only the latest 100 topics.
              topicUser.markModified('recentTopics');
              await topicUser.save();
            }
          }
          await updateProgressSafe(job, 100, 'completed', 'Job completed successfully');
          await appendLogSafe(jobId, `${JSON.stringify({ event: 'local_completion', output: outputJson || {} })}\n`, 'success');
        }
        return;
      }

      // Azure runner
      const AZURE_JOB_NAME = process.env.AZURE_JOB_NAME;
      const AZURE_RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP;
      const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;

      const missingAzureEnv = getMissingAzureRunnerEnv();
      if (missingAzureEnv.length > 0 || !AZURE_JOB_NAME || !AZURE_RESOURCE_GROUP || !AZURE_SUBSCRIPTION_ID) {
        const err: any = new Error(`Azure Container App Job configuration is missing: ${missingAzureEnv.join(', ')}`);
         err.stage = 'RENDER';
         throw err;
      }

      console.log(`Triggering Azure Container App Job: ${AZURE_JOB_NAME}`);

      let triggerSuccess = false;
      let executionName: string | null = null;
      try {
        const triggerResult = await triggerAzureJob(AZURE_JOB_NAME, envVars);
        triggerSuccess = Boolean(triggerResult.success);
        executionName = triggerResult.executionName;
        await JobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              'result.dispatch.azureJobName': String(AZURE_JOB_NAME || '').trim(),
              'result.dispatch.azureExecutionName': String(executionName || '').trim(),
            },
          }
        );
        clearAzureAuthFailure();
      } catch (azureError: any) {
        const azureErrorMessage = String(azureError?.message || 'Azure authentication failed');
        if (isAzureCredentialErrorMessage(azureErrorMessage)) {
          markAzureAuthFailure(azureErrorMessage);
          const err: any = new Error(
            `Azure authentication failed. Verify AZURE_TENANT_ID points to the tenant containing AZURE_CLIENT_ID. ${azureErrorMessage}`
          );
          err.stage = 'TOKEN';
          err.nonRetryable = true;
          throw err;
        }
        throw azureError;
      }

      if (triggerSuccess) {
         await appendLogSafe(
           jobId,
           `\nSuccessfully dispatched Azure Container App Job: ${AZURE_JOB_NAME}${executionName ? ` (execution=${executionName})` : ''}\n`
         );

         const user = await User.findById(userId);

         // Poll Azure Container Apps execution status
         const pollIntervalMs = 10000;
         const pollStart = Date.now();
         const jobTimeoutMs = Math.max(effectivePipelineExecutionTimeoutMs, 5 * 60 * 1000);
         const pollTimeoutMs = jobTimeoutMs + AZURE_EXECUTION_TIMEOUT_GRACE_MS;
         let lastLoggedStatus = '';
         let lastStatusLogAt = 0;
         let finalStatusMarker = 'PENDING_WEBHOOK';

         // Get ARM token for polling
         const armTokenUrl = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
         const armTokenParams = new URLSearchParams({
           grant_type: 'client_credentials',
           client_id: process.env.AZURE_CLIENT_ID || '',
           client_secret: process.env.AZURE_CLIENT_SECRET || '',
           scope: 'https://management.azure.com/.default',
         });

         let armAccessToken = '';
         try {
           const tokenRes = await fetch(armTokenUrl, {
             method: 'POST',
             headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
             body: armTokenParams.toString(),
           });
           const tokenData = await tokenRes.json() as { access_token?: string };
           armAccessToken = tokenData.access_token || '';
         } catch (tokenErr) {
           console.error(`Failed to acquire ARM token for polling job ${jobId}:`, tokenErr);
         }

         if (armAccessToken) {
           const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;
           const AZURE_RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || process.env.RESOURCE_GROUP;
           const armApiVersion = resolveAzureArmApiVersion(process.env.AZURE_ARM_API_VERSION);
           const executionsUrl = executionName
             ? `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.App/jobs/${AZURE_JOB_NAME}/executions/${encodeURIComponent(executionName)}?api-version=${armApiVersion}`
             : `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.App/jobs/${AZURE_JOB_NAME}/executions?api-version=${armApiVersion}`;

           while (Date.now() - pollStart < pollTimeoutMs) {
             await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

             try {
               const execRes = await fetch(executionsUrl, {
                 headers: { Authorization: `Bearer ${armAccessToken}` },
               });

               if (!execRes.ok) {
                 console.warn(`ARM polling HTTP ${execRes.status} for job ${jobId}`);
                 continue;
               }

                let latestStatus = '';
                if (executionName) {
                  const executionData = await execRes.json() as { properties?: { status?: string } };
                  latestStatus = executionData?.properties?.status || '';
                } else {
                  const execData = await execRes.json() as {
                    value?: Array<{ properties?: { status?: string; startTime?: string } }>
                  };
                  const executions = execData.value || [];
                  if (executions.length === 0) continue;
                  // Sort by startTime descending, take latest
                  const sorted = executions.sort((a, b) => {
                    const timeA = a.properties?.startTime || '';
                    const timeB = b.properties?.startTime || '';
                    return timeB.localeCompare(timeA);
                  });
                  latestStatus = sorted[0]?.properties?.status || '';
                }
                const normalizedStatus = latestStatus || 'Unknown';
                const now = Date.now();
                if (normalizedStatus !== lastLoggedStatus || now - lastStatusLogAt >= 60_000) {
                  const elapsedSeconds = Math.max(0, Math.round((now - pollStart) / 1000));
                  await appendLogSafe(jobId, `\n[Azure] Execution status: ${normalizedStatus} (elapsed=${elapsedSeconds}s)`);
                  lastLoggedStatus = normalizedStatus;
                  lastStatusLogAt = now;
                }

               if (latestStatus === 'Succeeded') {
                 finalStatusMarker = 'SUCCESS';
                 break;
               } else if (
                 latestStatus === 'Failed' ||
                 latestStatus === 'Stopped' ||
                 latestStatus === 'Degraded'
               ) {
                 finalStatusMarker = 'FAILED';
                 break;
               }
               // Running/Pending/Scheduled — keep polling
             } catch (pollErr) {
               console.warn(`ARM polling error for job ${jobId}:`, pollErr);
             }
           }

           if (Date.now() - pollStart >= pollTimeoutMs) {
             await appendLogSafe(
               jobId,
               `\n[Azure] Job timed out after ${jobTimeoutMs}ms (+${AZURE_EXECUTION_TIMEOUT_GRACE_MS}ms grace). Attempting execution stop...`
             );
             if (executionName) {
               try {
                 const stopResult = await stopAzureJobExecution(String(AZURE_JOB_NAME || ''), executionName);
                 await appendLogSafe(
                   jobId,
                   `\n[Azure] Stop request result for execution=${executionName}: ${stopResult.success ? 'success' : 'failed'}${stopResult.message ? ` (${stopResult.message})` : ''}`
                 );
               } catch (stopError: any) {
                 await appendLogSafe(jobId, `\n[Azure] Stop request threw error: ${String(stopError?.message || stopError || 'unknown')}`);
               }
             }
             finalStatusMarker = 'FAILED';
           }
         } else {
           // No ARM token available — fall back to webhook-driven status
           await appendLogSafe(jobId, `\n[Azure] No ARM token — relying on webhook for status updates.`);
           finalStatusMarker = 'PENDING_WEBHOOK';
         }

         // Fetch the latest logs to evaluate specific backend markers
         // since Python webhook may have updated them asynchronously
         const finalDbJob = await JobModel.findById(jobId).select('logs videoUrl youtubeVideoId result processedVideos');
         const finalLogs = String(finalDbJob?.logs || '');
         const resolvedVideoUrl = String(
           (finalDbJob as any)?.videoUrl ||
           (finalDbJob as any)?.result?.videoUrl ||
           (finalDbJob as any)?.result?.result?.videoUrl ||
           (finalDbJob as any)?.result?.youtube?.videoUrl ||
           ''
         ).trim();
         const resolvedYoutubeVideoId = String(
           (finalDbJob as any)?.youtubeVideoId ||
           (finalDbJob as any)?.result?.youtubeVideoId ||
           (finalDbJob as any)?.result?.result?.youtubeVideoId ||
           (finalDbJob as any)?.result?.youtube?.youtubeVideoId ||
           ''
         ).trim();
         const uploadConfirmedByData = !requiresUpload || Boolean(
           resolvedYoutubeVideoId ||
           (resolvedVideoUrl && /^https?:\/\//i.test(resolvedVideoUrl))
         );

         if (
             finalLogs.includes('PIPELINE_STATUS:YOUTUBE_REJECTED') ||
             finalLogs.includes('uploadLimitExceeded') ||
             finalLogs.includes('quotaExceeded') ||
             finalLogs.includes('dailyLimitExceeded')
         ) {
             finalStatusMarker = 'YOUTUBE_REJECTED';
         } else if (finalLogs.includes('PIPELINE_STATUS:SUCCESS')) {
             finalStatusMarker = 'SUCCESS';
         } else if (finalLogs.includes('PIPELINE_STATUS:FAILED')) {
             finalStatusMarker = 'FAILED';
         }

         if (finalStatusMarker === 'SUCCESS' && requiresUpload && !uploadConfirmedByData) {
           finalStatusMarker = 'PENDING_WEBHOOK';
           await appendLogSafe(
             jobId,
             '[Azure] Execution succeeded but upload confirmation is missing. Awaiting webhook confirmation.\n',
             'processing'
           );
         }

         // The webhook handles consumption now, but as a fallback, we check here too.
         // Let's rely entirely on the Webhook to mark holdReleased/holdConsumed for SUCCESS/FAILED.
         // However, if the job timed out and webhook never fired, we handle it here.

         if (finalStatusMarker === 'PENDING_WEBHOOK') {
           await JobModel.updateOne(
             { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
             {
               $set: {
                 status: 'processing',
                 progress: {
                   progress: 95,
                   stage: 'upload_confirmation_pending',
                   message: 'Waiting for final upload confirmation',
                   timestamp: new Date().toISOString(),
                 },
               },
             }
           );
           await appendLogSafe(jobId, '[Azure] Awaiting webhook confirmation. Hold settlement deferred.\n', 'processing');
           return;
         }

         const currentJobState = await JobModel.findById(jobId);
         if (!currentJobState || currentJobState.holdConsumed || currentJobState.holdReleased) {
            console.log(`Job ${jobId} already processed holds. Skipping double release/consume.`);
            return; // Already handled by Webhook or previous timeout
         }

         if (finalStatusMarker === 'SUCCESS') {
            const requestedUploads = getRequestedUploadCount(settings.videoCount);
            const updatedJob = await JobModel.findOneAndUpdate(
                { _id: jobId, status: 'processing', holdConsumed: false, holdReleased: false },
                {
                    $set: {
                        status: 'success',
                        completedAt: new Date(),
                        holdConsumed: true,
                        processedVideos: requestedUploads,
                        ...(resolvedVideoUrl ? { videoUrl: resolvedVideoUrl } : {}),
                        ...(resolvedYoutubeVideoId ? { youtubeVideoId: resolvedYoutubeVideoId } : {}),
                        errorMessage: '',
                        errorStage: undefined as any,
                        progress: {
                          progress: 100,
                          stage: 'completed',
                          message: 'Job completed successfully',
                          timestamp: new Date().toISOString(),
                        },
                        result: {
                          success: true,
                          ...(resolvedVideoUrl ? { videoUrl: resolvedVideoUrl } : {}),
                          ...(resolvedYoutubeVideoId ? { youtubeVideoId: resolvedYoutubeVideoId } : {}),
                        },
                    }
                },
                { returnDocument: 'after' }
            );

            if (updatedJob) {
               await consumeReservedCredits(userId, requestedUploads).catch(console.error);
            }

            // Handle Story Mode increment
            if (settings.storyMode && settings.storyId) {
                try {
                   const nextPart = (settings.currentPart || 1) + 1;
                   await StoryProgress.findOneAndUpdate(
                       { userId, storyId: settings.storyId },
                       {
                           $set: {
                               lastPrompt: generatedPrompt,
                               currentPart: nextPart
                           }
                       },
                       { upsert: true, returnDocument: 'after' }
                   );
                   console.log(`Story ${settings.storyId} progressed to part ${nextPart} for user ${userId}`);
                } catch (err) {
                   console.error('Failed to update StoryProgress', err);
                }
            }

            if (user) {
              await notifyUser(user, 'Video Upload Successful', '✅ Your video has been uploaded successfully.').catch(console.error);
            }
         } else if (finalStatusMarker === 'YOUTUBE_REJECTED') {
            const rejectedCount = getRequestedUploadCount(settings.videoCount);
            const consumeCount = acceptedYouTubeLimitWarning ? rejectedCount : 0;
            const releaseCount = Math.max(0, rejectedCount - consumeCount);
            const updatedJob = await JobModel.findOneAndUpdate(
              { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
              {
                $set: {
                  status: 'failed',
                  completedAt: new Date(),
                  holdConsumed: consumeCount > 0,
                  holdReleased: releaseCount > 0,
                  processedVideos: consumeCount,
                  error: 'YouTube Quota Exceeded',
                  errorMessage: 'YouTube Quota Exceeded',
                  errorStage: 'UPLOAD',
                }
              },
              { returnDocument: 'after' }
            );
            if (updatedJob) {
               if (consumeCount > 0) {
                 await consumeReservedCredits(userId, consumeCount).catch(console.error);
               }
               if (releaseCount > 0) {
                 await releaseReservedCredits(userId, releaseCount).catch(console.error);
               }
            }

            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video upload failed due to YouTube limits.').catch(console.error);
            }
         } else {
            const updatedJob = await JobModel.findOneAndUpdate(
                { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
                {
                    $set: {
                        status: 'failed',
                        completedAt: new Date(),
                        holdReleased: true,
                        error: 'Generation or upload failed',
                        errorMessage: 'Generation or upload failed',
                        errorStage: 'RENDER',
                    }
                },
                { returnDocument: 'after' }
            );
            if (updatedJob) {
               await releaseReservedCredits(userId, settings.videoCount || 1).catch(console.error);
            }

            // FAILED (normal) - do not increment usage
            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video generation or upload failed. Please try again.').catch(console.error);
            }
         }

      } else {
         const err: any = new Error("Failed to trigger Azure Container App Job via REST API");
         err.stage = 'RENDER';
         throw err;
      }

    } catch (error: any) {
      console.error(`Error processing job ${jobId}:`, error);

      if (process.env.SENTRY_DSN) {
        Sentry.captureException(error, { extra: { jobId, userId } });
      }

      const errorDetailParts = [
        typeof error?.stderrTail === 'string' && error.stderrTail ? `[stderr-tail]\n${error.stderrTail}` : '',
        typeof error?.stdoutTail === 'string' && error.stdoutTail ? `[stdout-tail]\n${error.stdoutTail}` : '',
      ].filter(Boolean);
      const errorMsg = `\nWorker Error: ${error.message}${errorDetailParts.length ? `\n${errorDetailParts.join('\n')}` : ''}`;
      const normalizedErrorStage = (error.stage === 'TOKEN' || error.stage === 'UPLOAD') ? error.stage : 'RENDER';
      const requestedUploads = getRequestedUploadCount(settings.videoCount);
      const consumeOnFailure = normalizedErrorStage === 'UPLOAD' && acceptedYouTubeLimitWarning;
      const failureProcessedVideos = consumeOnFailure ? requestedUploads : 0;
      const maxAttempts = Math.max(1, Number((job.opts as any)?.attempts || 1));
      const currentAttempt = Math.max(1, Number(job.attemptsMade || 0) + 1);
      const hasRetriesLeft = currentAttempt < maxAttempts;
      const retryableFailure =
        normalizedErrorStage !== 'TOKEN' &&
        normalizedErrorStage !== 'UPLOAD' &&
        error?.nonRetryable !== true;

      await appendLogSafe(jobId, errorMsg);

      if (retryableFailure && hasRetriesLeft) {
        const nextRunnerSelection = await resolvePipelineRunner((job.attemptsMade || 0) + 1);
        const unavailableRunners = Object.entries(nextRunnerSelection.availability)
          .filter(([, available]) => !available)
          .map(([runner]) => runner);
        const nextRunnerSummary = nextRunnerSelection.targetRunner === nextRunnerSelection.runner
          ? `${nextRunnerSelection.runner}`
          : `${nextRunnerSelection.targetRunner} -> ${nextRunnerSelection.runner}`;
        const retryDetails = [
          `next runner: ${nextRunnerSummary}`,
          unavailableRunners.length > 0 ? `unavailable: ${unavailableRunners.join(',')}` : '',
        ].filter(Boolean).join(' | ');

        const retried = await JobModel.findOneAndUpdate(
          { _id: jobId, status: { $in: ['pending', 'processing'] } },
          {
            $set: {
              status: 'pending',
              queuedAt: new Date(),
              progress: {
                progress: 10,
                stage: 'retrying',
                message: `Retry ${currentAttempt}/${maxAttempts - 1} scheduled (${retryDetails})`,
                timestamp: new Date().toISOString(),
              },
            },
            $unset: {
              startedAt: '',
              executionLockedAt: '',
              completedAt: '',
              error: '',
              errorMessage: '',
              errorStage: '',
            },
          },
          { returnDocument: 'after' }
        );

        if (retried) {
          await appendLogSafe(
            jobId,
            `[Retry] Attempt ${currentAttempt} failed at stage ${normalizedErrorStage}. Retrying (${retryDetails}).\n`,
            'pending'
          );
          await updateProgressSafe(job, 10, 'retrying', `Retry ${currentAttempt}/${maxAttempts - 1} queued`);
          throw error;
        }

        const existingState = await JobModel.findById(jobId).select('status').lean();
        const currentState = String(existingState?.status || '').toLowerCase();
        if (['success', 'completed', 'failed'].includes(currentState)) {
          return;
        }
      }

      await appendLogSafe(jobId, `[FinalFailure] Stage=${normalizedErrorStage} Attempt=${currentAttempt}/${maxAttempts}\n`, 'failed');

      // Gracefully handle failure and credit release atomically
      const updatedJob = await JobModel.findOneAndUpdate(
          { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
          {
              $set: {
                  status: 'failed',
                  completedAt: new Date(),
              holdConsumed: consumeOnFailure,
              holdReleased: !consumeOnFailure,
              processedVideos: failureProcessedVideos,
                  error: error.message,
                  errorMessage: error.message,
              errorStage: normalizedErrorStage,
              result: {
              success: false,
            stage: normalizedErrorStage,
              message: error.message,
              stderrTail: typeof error?.stderrTail === 'string' ? error.stderrTail : '',
              stdoutTail: typeof error?.stdoutTail === 'string' ? error.stdoutTail : '',
              failedAt: new Date().toISOString(),
              },
              }
          },
          { returnDocument: 'after' }
      );
      if (updatedJob) {
        if (consumeOnFailure) {
          await consumeReservedCredits(userId, requestedUploads).catch(console.error);
        } else {
          await releaseReservedCredits(userId, requestedUploads).catch(console.error);
        }
      }
      if (!updatedJob) {
        const existingJob = await JobModel.findById(jobId).select('status').lean();
        const currentStatus = String(existingJob?.status || '').toLowerCase();
        if (!['success', 'completed', 'failed'].includes(currentStatus)) {
          await JobModel.updateOne(
            { _id: jobId },
            {
              $set: {
                status: 'failed',
                completedAt: new Date(),
                holdConsumed: consumeOnFailure,
                holdReleased: !consumeOnFailure,
                processedVideos: failureProcessedVideos,
                error: error.message,
                errorMessage: error.message,
                errorStage: normalizedErrorStage,
                result: {
                  success: false,
                  stage: normalizedErrorStage,
                  message: error.message,
                  stderrTail: typeof error?.stderrTail === 'string' ? error.stderrTail : '',
                  stdoutTail: typeof error?.stdoutTail === 'string' ? error.stdoutTail : '',
                  failedAt: new Date().toISOString(),
                },
              },
            }
          ).catch((dbErr) => {
            console.error(`[PipelineWorker] Failed to force-update failed state for job ${jobId}:`, dbErr);
          });
        }
      }

      await updateProgressSafe(job, 99, 'failed', 'Job failed');

      if (normalizedErrorStage === 'TOKEN' || normalizedErrorStage === 'UPLOAD') {
        throw new UnrecoverableError(error.message || 'YouTube token failure');
      }
      throw error;
    } finally {
      await releaseLock(lockKey).catch((err) => console.error(`Failed to release lock for ${jobId}:`, err));
      // Decrease the channel specific hold unconditionally if the job finished/failed/was skipped
      // The `releaseReservedCredits` covers global. Channel holds are just local guards.
      const dbJob = await JobModel.findById(jobId);
      if (dbJob && dbJob.status !== 'processing' && dbJob.status !== 'pending') {
        const decrementCount = getRequestedUploadCount(settings.videoCount);
        const channelIdForHold = resolveJobChannelId(dbJob as Record<string, any>) || String(settings.channelId || '').trim();
        if (channelIdForHold) {
          await decrementChannelVideosOnHold(userId, channelIdForHold, decrementCount).catch((err) => {
            console.error(`Failed to decrement channel holds for user ${userId}:`, err);
          });
        }

        await reconcileUserHoldCounters(userId).catch((err) => {
          console.warn(`[PipelineWorker] Failed to reconcile global holds for user ${userId}:`, err);
        });

        await applyUserJobHistoryRetention(userId).catch((err) => {
          console.warn(`[PipelineWorker] Failed to apply job history retention for user ${userId}:`, err);
        });
      }
    }
  },
  {
    connection: connection as any, // Cast to any to bypass strict type matching
    concurrency: workerConcurrency,
    lockDuration: 60000,
    stalledInterval: 30000,
    maxStalledCount: 2,
  }
);

startWorkerHeartbeat();
startQueueSelfHealWatchdog();

pipelineWorker.on('completed', (job) => {
  console.log(`[PipelineWorker] BullMQ completed job ${job.id}.`);
});

pipelineWorker.on('failed', (job, err) => {
  console.error(`[PipelineWorker] Job ${job?.id} has failed in BullMQ with error: ${err.message}`, err);
});

pipelineWorker.on('stalled', (jobId) => {
  console.warn(`[PipelineWorker] Job stalled and will be retried: ${jobId}`);
});

pipelineWorker.on('error', (err) => {
  console.error('[PipelineWorker] Worker runtime error:', err);
  if (!isEmbeddedWorkerProcess) {
    console.error('[PipelineWorker] Dedicated worker exiting due to runtime error.');
    process.exit(1);
  }
});

// Graceful Shutdown
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, closing worker gracefully...`);
  stopQueueSelfHealWatchdog();
  await stopWorkerHeartbeat();
  await pipelineWorker.close();
  if (connection) {
    await connection.quit();
  }
  await mongoose.connection.close();
  console.log('Worker closed. Exiting process.');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default pipelineWorker;
