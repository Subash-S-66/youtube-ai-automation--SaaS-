import { google } from 'googleapis';

const normalizeBaseUrl = (value?: string): string => {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
};

const resolveRedirectUri = (backendBaseUrl?: string): string => {
  const explicitRedirect = process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  if (explicitRedirect && explicitRedirect.trim()) {
    return explicitRedirect.trim();
  }
  const base = normalizeBaseUrl(backendBaseUrl || process.env.BACKEND_URL);
  if (!base) return '';
  return `${base}/api/youtube/callback`;
};

export const getGoogleOAuthClient = (backendBaseUrl?: string) => {
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

export const exchangeCodeForTokens = async (code: string, backendBaseUrl?: string) => {
  const oauth2Client = getGoogleOAuthClient(backendBaseUrl);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};
