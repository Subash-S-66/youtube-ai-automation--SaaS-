import dotenv from 'dotenv';
import path from 'path';
import connectDB from '../config/db';
import SystemConfig from '../models/SystemConfig';
import { ensureSystemConfigSingleton } from '../utils/ensureSystemConfig';
import { recoverCrashedJobs, reconcileQueueWithDatabase, startStuckJobCleanupInterval } from './stuckJobCleanup';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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

const enableWorkerStuckCleanup = parseBooleanEnv(
  process.env.WORKER_ENABLE_STUCK_JOB_CLEANUP,
  true
);

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const WORKER_QUEUE_RECONCILE_INTERVAL_MS = parsePositiveInt(
  process.env.WORKER_QUEUE_RECONCILE_INTERVAL_MS,
  2 * 60 * 1000
);

const normalizeWorkerProfile = (value: unknown): 'local' | 'vm' | 'cloud' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'vm') {
    return 'vm';
  }
  if (normalized === 'cloud') {
    return 'cloud';
  }
  return 'local';
};

const normalizeWorkerConcurrency = (value: unknown): number | null => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(1, Math.min(32, Math.floor(parsed)));
};

const bootstrapPipelineWorker = async (): Promise<void> => {
  await connectDB();
  await ensureSystemConfigSingleton();

  try {
    await reconcileQueueWithDatabase();
    console.log('[WorkerBootstrap] Pending queue reconciliation completed at startup.');
  } catch (error) {
    console.warn('[WorkerBootstrap] Pending queue reconciliation failed at startup:', error);
  }

  const reconcileTimer = setInterval(() => {
    void reconcileQueueWithDatabase().catch((error) => {
      console.warn('[WorkerBootstrap] Pending queue reconciliation failed:', error);
    });
  }, WORKER_QUEUE_RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();

  if (enableWorkerStuckCleanup) {
    await recoverCrashedJobs();
    startStuckJobCleanupInterval();
    console.log('[WorkerBootstrap] Stuck-job recovery and cleanup interval enabled for dedicated worker process.');
  } else {
    console.log('[WorkerBootstrap] Stuck-job cleanup is disabled for dedicated worker process.');
  }

  try {
    const config = await SystemConfig.findOne()
      .sort({ updatedAt: -1 })
      .select('pipelineWorkerProfile pipelineWorkerConcurrency pipelineRunnerPinned');

    const runtimeWorkerProfile = normalizeWorkerProfile(config?.pipelineWorkerProfile);
    const runtimeWorkerConcurrency = normalizeWorkerConcurrency(config?.pipelineWorkerConcurrency);

    process.env.PIPELINE_WORKER_PROFILE = runtimeWorkerProfile;
    if (runtimeWorkerConcurrency && runtimeWorkerConcurrency > 0) {
      process.env.PIPELINE_WORKER_CONCURRENCY = String(runtimeWorkerConcurrency);
    } else {
      delete process.env.PIPELINE_WORKER_CONCURRENCY;
    }

    if (typeof config?.pipelineRunnerPinned === 'boolean') {
      process.env.PIPELINE_RUNNER_PINNED = config.pipelineRunnerPinned ? 'true' : 'false';
    }

    console.log(
      `[WorkerBootstrap] Loaded runtime config from SystemConfig: profile=${runtimeWorkerProfile}, concurrency=${runtimeWorkerConcurrency ?? 'auto'}, pinned=${process.env.PIPELINE_RUNNER_PINNED || 'false'}`
    );
  } catch (error) {
    console.warn('[WorkerBootstrap] Failed to load SystemConfig runtime controls. Using env defaults.', error);
  }

  // Load worker only after runtime controls are prepared.
  require('./pipelineWorker');
};

void bootstrapPipelineWorker().catch((error) => {
  console.error('[WorkerBootstrap] Failed to start pipeline worker:', error);
  process.exit(1);
});
