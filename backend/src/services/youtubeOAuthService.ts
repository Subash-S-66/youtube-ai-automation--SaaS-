import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';

const YOUTUBE_CALLBACK_PATH = '/api/youtube/callback';

const decodeUrlValue = (value: string): string => {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
};

const normalizeBaseUrl = (value?: string): string => {
  const raw = decodeUrlValue(value || '')
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!raw) return '';

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    const localLike = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(candidate);
    candidate = `${localLike ? 'http' : 'https'}://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
};

const resolveRedirectUri = (backendBaseUrl?: string): string => {
  // Always use the canonical route path registered by this backend.
  // Env values can carry stale paths or query params and cause redirect_uri_mismatch.
  const base = normalizeBaseUrl(
    process.env.YOUTUBE_REDIRECT_URI ||
      backendBaseUrl ||
      process.env.BACKEND_URL
  );
  if (!base) return '';
  return `${base}${YOUTUBE_CALLBACK_PATH}`;
};

export const getGoogleOAuthClient = (backendBaseUrl?: string): OAuth2Client => {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveRedirectUri(backendBaseUrl);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing YouTube OAuth environment variables (client/secret/redirect)');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

export const getGoogleAuthUrl = (state: string, backendBaseUrl?: string): string => {
  const oauth2Client = getGoogleOAuthClient(backendBaseUrl);

  // Define the scopes we need
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Request a refresh token
    scope: scopes,
    state, // Pass the short-lived signed JWT for validation on callback
    prompt: 'consent' // Force to get refresh token
  });
};

export const exchangeCodeForTokens = async (code: string, backendBaseUrl?: string): Promise<Credentials> => {
  const oauth2Client = getGoogleOAuthClient(backendBaseUrl);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};
