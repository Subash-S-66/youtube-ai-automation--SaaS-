export interface PipelineConcurrencyByPlan {
  free: number;
  basic: number;
  pro: number;
  premium: number;
}

export const DEFAULT_PIPELINE_CONCURRENCY_BY_PLAN: PipelineConcurrencyByPlan = {
  free: 2,
  basic: 5,
  pro: 10,
  premium: 20,
};

const clampConcurrencyLimit = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.floor(parsed)));
};

export const sanitizePipelineConcurrencyByPlan = (input: unknown): PipelineConcurrencyByPlan => {
  const raw = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {};
  return {
    free: clampConcurrencyLimit(raw.free, DEFAULT_PIPELINE_CONCURRENCY_BY_PLAN.free),
    basic: clampConcurrencyLimit(raw.basic, DEFAULT_PIPELINE_CONCURRENCY_BY_PLAN.basic),
    pro: clampConcurrencyLimit(raw.pro, DEFAULT_PIPELINE_CONCURRENCY_BY_PLAN.pro),
    premium: clampConcurrencyLimit(raw.premium, DEFAULT_PIPELINE_CONCURRENCY_BY_PLAN.premium),
  };
};

export const getPipelineConcurrencyLimitForPlan = (
  plan: string,
  config?: { pipelineConcurrencyByPlan?: unknown },
  fallbackLimit: number = 10
): number => {
  const byPlan = sanitizePipelineConcurrencyByPlan(config?.pipelineConcurrencyByPlan);
  const normalizedPlan = String(plan || '').trim().toLowerCase();

  if (normalizedPlan === 'premium') return byPlan.premium;
  if (normalizedPlan === 'pro') return byPlan.pro;
  if (normalizedPlan === 'basic') return byPlan.basic;
  if (normalizedPlan === 'free') return byPlan.free;

  // Unknown plans use a conservative, configurable fallback.
  return clampConcurrencyLimit(fallbackLimit, DEFAULT_PIPELINE_CONCURRENCY_BY_PLAN.free);
};
