const normalizeBase = (value: string) => value.replace(/\/+$/, '');

const getDefaultApiOrigin = () => 'http://localhost:5000';

export const getApiOrigin = () => {
  const raw = process.env.NEXT_PUBLIC_API_URL || getDefaultApiOrigin();
  const normalized = normalizeBase(raw);
  return normalized.endsWith('/api') ? normalized.slice(0, -4) : normalized;
};

export const getApiBase = () =>
  process.env.NODE_ENV === 'development'
    ? '/api'
    : `${getApiOrigin()}/api`;
