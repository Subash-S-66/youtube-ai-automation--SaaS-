export type PlanType = 'free' | 'basic' | 'pro' | 'premium';

export const planLimits: Record<PlanType, number> = {
  free: 2,
  basic: 10,
  pro: 25,
  premium: 100,
};

export const resolvePlanLimit = (
  plan: PlanType,
  overrides?: Partial<Record<PlanType, number>>
): number => {
  const overrideValue = overrides?.[plan];
  if (typeof overrideValue === 'number' && Number.isFinite(overrideValue) && overrideValue > 0) {
    return overrideValue;
  }
  return planLimits[plan] || planLimits.free;
};
