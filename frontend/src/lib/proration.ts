const planValue: Record<string, number> = { free: 0, basic: 1, pro: 2, premium: 4 };

export const roundProratedDays = (days: number) => {
  const whole = Math.floor(days);
  const frac = days - whole;
  return whole + (frac >= 0.3 ? 1 : 0);
};

export const computeProrationDays = (
  currentPlan: string,
  targetPlan: string,
  remainingDays: number
) => {
  const currentVal = planValue[String(currentPlan || '').toLowerCase()] ?? 0;
  const targetVal = planValue[String(targetPlan || '').toLowerCase()] ?? 0;
  if (currentVal <= 0 || targetVal <= 0 || remainingDays <= 0) return 0;
  const raw = remainingDays * (currentVal / targetVal);
  return roundProratedDays(raw);
};

export const getRemainingDays = (expiresAt?: string | Date | null) => {
  if (!expiresAt) return 0;
  const date = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return diffMs / (1000 * 60 * 60 * 24);
};
