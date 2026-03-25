import { google } from 'googleapis';

export const getGoogleOAuthClient = () => {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing YouTube OAuth environment variables');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

export const getGoogleAuthUrl = (state: string): string => {
  const oauth2Client = getGoogleOAuthClient();

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

export const exchangeCodeForTokens = async (code: string) => {
  const oauth2Client = getGoogleOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};
