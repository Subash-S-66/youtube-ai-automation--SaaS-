export const PLAN_LIMITS: Record<string, number> = {
  free: 3,
  basic: 10,
  pro: 25,
  premium: 100,
};

export type PlanType = 'free' | 'basic' | 'pro' | 'premium';
