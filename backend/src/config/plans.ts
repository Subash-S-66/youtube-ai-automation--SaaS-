export type PlanType = 'free' | 'basic' | 'pro' | 'premium';

export const planLimits: Record<PlanType, number> = {
  free: 3,
  basic: 10,
  pro: 25,
  premium: 100,
};
