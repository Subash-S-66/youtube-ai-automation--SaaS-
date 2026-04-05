import dotenv from 'dotenv';
import path from 'path';
import connectDB from '../config/db';
import SystemConfig from '../models/SystemConfig';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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
