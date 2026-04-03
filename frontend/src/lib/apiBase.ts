const normalizeBase = (value: string) => value.replace(/\/+$/, '');

const stripWrappedQuotes = (value: string) => value.replace(/^['"]+|['"]+$/g, '');

const sanitizeOrigin = (value: string) => {
  const compact = stripWrappedQuotes((value || '').trim()).replace(/\s+/g, '');
  if (!compact) return '';
  if (/^https?:\/\//i.test(compact) || compact.startsWith('/')) {
    return compact;
  }
  return `https://${compact}`;
};

const getDefaultApiOrigin = () => 'http://localhost:5000';

export const getApiOrigin = () => {
  const raw = sanitizeOrigin(process.env.NEXT_PUBLIC_API_URL || '') || getDefaultApiOrigin();
  const normalized = normalizeBase(raw);
  return normalized.endsWith('/api') ? normalized.slice(0, -4) : normalized;
};

export const buildApiUrl = (path: string) => {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  const origin = getApiOrigin();
  try {
    return new URL(safePath, origin).toString();
  } catch {
    return `${normalizeBase(origin)}${safePath}`;
  }
};

export const getApiBase = () =>
  process.env.NODE_ENV === 'development'
    ? '/api'
    : `${getApiOrigin()}/api`;
