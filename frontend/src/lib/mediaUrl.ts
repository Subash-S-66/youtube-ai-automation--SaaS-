import { getApiOrigin } from './apiBase';

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

export const getMediaUrl = (rawPath?: string) => {
  if (!rawPath) return '';
  if (isHttpUrl(rawPath)) return rawPath;

  const normalized = rawPath.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const uploadsIdx = lower.lastIndexOf('/uploads/');

  if (uploadsIdx !== -1) {
    const filename = normalized.substring(uploadsIdx).split('/').pop();
    return `${getApiOrigin()}/api/media/file/${filename}`;
  }

  if (lower.startsWith('uploads/')) {
    const filename = normalized.split('/').pop();
    return `${getApiOrigin()}/api/media/file/${filename}`;
  }

  const trimmed = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  return `${getApiOrigin()}/${trimmed}`;
};
