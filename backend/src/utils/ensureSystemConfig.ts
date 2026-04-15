import SystemConfig from '../models/SystemConfig';
import {
  sanitizePipelineCycleAcrossRunners,
  sanitizePipelineRetryCycles,
  sanitizePipelineRetriesByPlan,
  sanitizePipelineRunnerFallbackOrder,
} from '../services/pipelineRetryPolicyService';
import { sanitizePipelineConcurrencyByPlan } from '../services/pipelineConcurrencyPolicyService';
import {
  sanitizeJobHistoryLimitByPlan,
  sanitizeJobHistoryMinAgeDays,
} from '../services/jobHistoryRetentionPolicyService';
import {
  resolveDefaultPipelineExecutionTimeoutMinutes,
  sanitizeCompositionHeartbeatSeconds,
  sanitizeFfmpegCommandTimeoutSeconds,
  sanitizePipelineExecutionTimeoutMinutes,
} from '../services/pipelineRuntimeControlService';

const parseBooleanConfig = (value: unknown, fallback: boolean): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

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

const normalizeOptionalText = (value: unknown, maxLength = 500): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.slice(0, maxLength);
};

const normalizeGeminiModel = (value: unknown): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return String(process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview').trim() || 'gemini-3.1-flash-lite-preview';
  }
  return normalized.slice(0, 120);
};

export const ensureSystemConfigSingleton = async (): Promise<void> => {
  const latest = await SystemConfig.findOne().sort({ updatedAt: -1 });
  if (!latest) {
    await SystemConfig.create({
      betaMode: false,
      geminiModel: normalizeGeminiModel(undefined),
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
    });
    return;
  }

  await SystemConfig.updateOne(
    { _id: latest._id },
    {
      $set: {
        pipelineConcurrencyByPlan: sanitizePipelineConcurrencyByPlan((latest as any).pipelineConcurrencyByPlan),
        pipelineRetriesByPlan: sanitizePipelineRetriesByPlan((latest as any).pipelineRetriesByPlan),
        pipelineRetryCycles: sanitizePipelineRetryCycles((latest as any).pipelineRetryCycles),
        pipelineCycleAcrossRunners: sanitizePipelineCycleAcrossRunners((latest as any).pipelineCycleAcrossRunners, true),
        pipelineRunnerFallbackOrder: sanitizePipelineRunnerFallbackOrder((latest as any).pipelineRunnerFallbackOrder),
        pipelineServiceUrl: normalizeOptionalText((latest as any).pipelineServiceUrl, 500),
        pipelineServiceSecret: normalizeOptionalText((latest as any).pipelineServiceSecret, 500),
        geminiModel: normalizeGeminiModel((latest as any).geminiModel),
        pipelineRunnerPinned: parseBooleanConfig((latest as any).pipelineRunnerPinned, false),
        ffmpegCommandTimeoutSeconds: sanitizeFfmpegCommandTimeoutSeconds((latest as any).ffmpegCommandTimeoutSeconds),
        compositionHeartbeatSeconds: sanitizeCompositionHeartbeatSeconds((latest as any).compositionHeartbeatSeconds),
        pipelineExecutionTimeoutMinutes: sanitizePipelineExecutionTimeoutMinutes((latest as any).pipelineExecutionTimeoutMinutes)
          ?? resolveDefaultPipelineExecutionTimeoutMinutes(),
        runEmbeddedWorker: parseBooleanConfig((latest as any).runEmbeddedWorker, false),
        autoStartEmbeddedWorkerWhenMissing: parseBooleanConfig((latest as any).autoStartEmbeddedWorkerWhenMissing, false),
        includeEmbeddedWorkersInRuntimeStatus: parseBooleanConfig((latest as any).includeEmbeddedWorkersInRuntimeStatus, false),
        pipelineWorkerProfile: normalizeWorkerProfile((latest as any).pipelineWorkerProfile),
        pipelineWorkerConcurrency: normalizeWorkerConcurrency((latest as any).pipelineWorkerConcurrency),
        jobHistoryLimitByPlan: sanitizeJobHistoryLimitByPlan((latest as any).jobHistoryLimitByPlan),
        jobHistoryMinAgeDays: sanitizeJobHistoryMinAgeDays((latest as any).jobHistoryMinAgeDays),
      },
    }
  );

  await SystemConfig.deleteMany({ _id: { $ne: latest._id } });
};
