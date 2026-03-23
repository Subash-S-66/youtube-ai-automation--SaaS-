const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const parseOrigins = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const getAllowedOrigins = (): string[] => {
  const raw = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '';
  const envOrigins = parseOrigins(raw);
  const isProduction = process.env.NODE_ENV === 'production';

  const combined = isProduction ? envOrigins : [...envOrigins, ...DEV_ORIGINS];

  if (!combined.length) {
    return isProduction ? [] : [...DEV_ORIGINS];
  }

  return Array.from(new Set(combined));
};
