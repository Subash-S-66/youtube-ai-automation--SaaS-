export type PipelineRunner = 'local' | 'azure' | 'remote';

export interface PipelineRetriesByPlan {
  free: number;
  basic: number;
  pro: number;
  premium: number;
}

export const DEFAULT_PIPELINE_RETRIES_BY_PLAN: PipelineRetriesByPlan = {
  free: 2,
  basic: 3,
  pro: 3,
  premium: 5,
};

export const DEFAULT_PIPELINE_RUNNER_FALLBACK_ORDER: PipelineRunner[] = ['azure', 'remote', 'local'];

const clampRetryCount = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(10, Math.floor(parsed)));
};

const normalizeRunner = (value: unknown): PipelineRunner | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'local' || raw === 'azure' || raw === 'remote') {
    return raw;
  }
  return null;
};

export const sanitizePipelineRetriesByPlan = (input: unknown): PipelineRetriesByPlan => {
  const raw = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {};
  return {
    free: clampRetryCount(raw.free, DEFAULT_PIPELINE_RETRIES_BY_PLAN.free),
    basic: clampRetryCount(raw.basic, DEFAULT_PIPELINE_RETRIES_BY_PLAN.basic),
    pro: clampRetryCount(raw.pro, DEFAULT_PIPELINE_RETRIES_BY_PLAN.pro),
    premium: clampRetryCount(raw.premium, DEFAULT_PIPELINE_RETRIES_BY_PLAN.premium),
  };
};

export const sanitizePipelineRunnerFallbackOrder = (input: unknown): PipelineRunner[] => {
  const rawValues = Array.isArray(input) ? input : DEFAULT_PIPELINE_RUNNER_FALLBACK_ORDER;
  const seen = new Set<PipelineRunner>();
  const normalized: PipelineRunner[] = [];

  for (const value of rawValues) {
    const runner = normalizeRunner(value);
    if (!runner || seen.has(runner)) {
      continue;
    }
    seen.add(runner);
    normalized.push(runner);
  }

  if (normalized.length === 0) {
    return [...DEFAULT_PIPELINE_RUNNER_FALLBACK_ORDER];
  }
  return normalized;
};

export const getPipelineRetryCountForPlan = (
  plan: string,
  config?: { pipelineRetriesByPlan?: unknown }
): number => {
  const retries = sanitizePipelineRetriesByPlan(config?.pipelineRetriesByPlan);
  const normalizedPlan = String(plan || '').trim().toLowerCase();

  if (normalizedPlan === 'premium') return retries.premium;
  if (normalizedPlan === 'pro') return retries.pro;
  if (normalizedPlan === 'basic') return retries.basic;
  return retries.free;
};

export const getPipelineAttemptsForPlan = (
  plan: string,
  config?: { pipelineRetriesByPlan?: unknown }
): number => {
  const retryCount = getPipelineRetryCountForPlan(plan, config);
  return Math.max(1, retryCount + 1);
};

export const buildRunnerSequence = (
  primaryRunner: PipelineRunner,
  fallbackOrder?: unknown
): PipelineRunner[] => {
  const ordered = sanitizePipelineRunnerFallbackOrder(fallbackOrder);
  const sequence: PipelineRunner[] = [primaryRunner];

  for (const runner of ordered) {
    if (!sequence.includes(runner)) {
      sequence.push(runner);
    }
  }

  return sequence;
};

export const pickRunnerForAttempt = (
  primaryRunner: PipelineRunner,
  fallbackOrder: unknown,
  attemptsMade: number
): PipelineRunner => {
  const sequence = buildRunnerSequence(primaryRunner, fallbackOrder);
  if (sequence.length === 1) {
    return sequence[0] as PipelineRunner;
  }

  const index = Math.max(0, Math.floor(Number(attemptsMade) || 0)) % sequence.length;
  return sequence[index] as PipelineRunner;
};
