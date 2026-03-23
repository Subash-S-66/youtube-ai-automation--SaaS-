const normalizeBase = (value: string) => value.replace(/\/+$/, '');

export const getApiOrigin = () => {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  const normalized = normalizeBase(raw);
  return normalized.endsWith('/api') ? normalized.slice(0, -4) : normalized;
};

export const getApiBase = () => `${getApiOrigin()}/api`;
