import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { getGoogleAuthUrl, exchangeCodeForTokens, getGoogleOAuthClient } from '../services/youtubeOAuthService';
import User from '../models/User';
import { google } from 'googleapis';

const resolveBackendBaseUrl = (req: Request): string => {
  const explicit = (process.env.BACKEND_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  return host ? `${proto}://${host}` : '';
};

const resolveFrontendBaseUrl = (req: Request): string => {
  const explicit = (process.env.FRONTEND_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const backendBase = resolveBackendBaseUrl(req);
  return backendBase || '';
};

// Generate short-lived JWT for state parameter (5 minutes)
const generateStateToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined');
  }

  return jwt.sign({ id: userId }, secret, {
    expiresIn: '5m',
  });
};

// @desc    Connect YouTube account
// @route   GET /api/youtube/auth
// @access  Private
export const connectYouTube = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  // Create a short-lived signed token with the user's ID
  const stateToken = generateStateToken(req.user.id);

  // Set as HTTP-only cookie
  res.cookie('oauth_state', stateToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 5 * 60 * 1000, // 5 minutes
  });

  // Pass a generic string or empty state for the actual OAuth URL param since we rely on the cookie
  const authUrl = getGoogleAuthUrl('youtube-auth', resolveBackendBaseUrl(req));

  // Redirect user to Google OAuth consent screen
  res.redirect(authUrl);
});

// @desc    Get YouTube OAuth URL (JSON)
// @route   GET /api/youtube/auth-url
// @access  Private
export const getYouTubeAuthUrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const reconnectChannelId = typeof req.query.reconnectChannelId === 'string'
    ? req.query.reconnectChannelId.trim()
    : '';
  if (reconnectChannelId) {
    const user = await User.findById(req.user.id).select('youtubeChannels');
    const hasChannel = !!user?.youtubeChannels?.some((c: any) => c.channelId === reconnectChannelId);
    if (!hasChannel) {
      throw new AppError('Reconnect channel not found for this user', 404);
    }
    res.cookie('oauth_reconnect_channel', reconnectChannelId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });
  } else {
    res.clearCookie('oauth_reconnect_channel');
  }

  const stateToken = generateStateToken(req.user.id);

  res.cookie('oauth_state', stateToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 5 * 60 * 1000,
  });

  const authUrl = getGoogleAuthUrl('youtube-auth', resolveBackendBaseUrl(req));
  res.json({ success: true, url: authUrl });
});

// @desc    YouTube OAuth callback
// @route   GET /api/youtube/callback
// @access  Private (protected by state token via middleware)
export const youtubeCallback = asyncHandler(async (req: Request, res: Response) => {
  // Clear the state cookie
  const reconnectChannelId = req.cookies?.oauth_reconnect_channel as string | undefined;
  res.clearCookie('oauth_state');
  res.clearCookie('oauth_reconnect_channel');
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error) {
    throw new AppError(`Google OAuth Error: ${error}`, 400);
  }

  if (!code) {
    throw new AppError('Authorization code is missing', 400);
  }

  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  try {
    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(code, resolveBackendBaseUrl(req));

    const user = await User.findById(req.user.id);
    if (!user) {
        throw new AppError('User not found', 404);
    }

    // Fetch channel info
    const oauth2Client = getGoogleOAuthClient(resolveBackendBaseUrl(req));
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Default values if we can't fetch channel
    let channelId = `channel_${Date.now()}`;
    let channelName = `YouTube Channel`;

    try {
      const channelResponse = await youtube.channels.list({
        part: ['snippet'],
        mine: true,
      });

      if (channelResponse.data.items && channelResponse.data.items.length > 0) {
        channelId = channelResponse.data.items[0]!.id || channelId;
        channelName = channelResponse.data.items[0]!.snippet?.title || channelName;
      }
    } catch (channelErr) {
      console.error('Failed to fetch YouTube channel details:', channelErr);
      // Fallback: Continue with default channel ID/Name if API fails
    }

    // Save tokens in MongoDB
    const existingChannelIndex = user.youtubeChannels.findIndex(c => c.channelId === channelId);
    const reconnectChannelIndex = reconnectChannelId
      ? user.youtubeChannels.findIndex(c => c.channelId === reconnectChannelId)
      : -1;
    const newTokens = {
        access_token: tokens.access_token || undefined,
        refresh_token: tokens.refresh_token || undefined,
        expiry_date: tokens.expiry_date || undefined,
    };

    // Reconnect flow: always repair the requested channel entry, even if returned channelId changed.
    if (reconnectChannelIndex !== -1 && user.youtubeChannels[reconnectChannelIndex]) {
      user.youtubeChannels[reconnectChannelIndex].tokens = {
        ...user.youtubeChannels[reconnectChannelIndex].tokens,
        ...newTokens
      };
      user.youtubeChannels[reconnectChannelIndex].channelName = channelName;
      user.youtubeChannels[reconnectChannelIndex].channelId = channelId;
      user.youtubeChannels[reconnectChannelIndex].isValid = true;

      // De-duplicate any additional stale entries for the same resolved channelId.
      user.youtubeChannels = user.youtubeChannels.filter((channel, idx) => {
        if (idx === reconnectChannelIndex) return true;
        return channel.channelId !== channelId;
      });
    } else if (existingChannelIndex !== -1) {
       // Update existing channel
       if (user.youtubeChannels[existingChannelIndex]) {
           user.youtubeChannels[existingChannelIndex].tokens = {
               ...user.youtubeChannels[existingChannelIndex].tokens,
               ...newTokens
           };
           user.youtubeChannels[existingChannelIndex].channelName = channelName; // Update name just in case
           user.youtubeChannels[existingChannelIndex].isValid = true;
       }
    } else {
       // Enforce Channel Limits dynamically with effective plan
       const { getUploadLimits } = require('../services/uploadLimitService');
       const limitCheck = await getUploadLimits(user.id);
       const effectivePlan = limitCheck.plan;

       const channelLimits = {
         free: 1,
         basic: 3,
         pro: 10,
         premium: 50,
       };
       const maxChannels = (channelLimits as any)[effectivePlan] || 1;

       if (user.youtubeChannels.length >= maxChannels) {
           const frontendUrl = resolveFrontendBaseUrl(req);
           return res.redirect(`${frontendUrl}/dashboard?error=channel_limit_reached`);
       }

       // Add new channel
       user.youtubeChannels.push({
           channelId,
           channelName,
           tokens: newTokens,
           videosOnHold: 0,
           isValid: true,
       });
    }

    user.isYoutubeConnected = true;

    user.markModified('youtubeChannels');
    await user.save();

    // Redirect to frontend (placeholder)
    // Replace this with the actual frontend URL once built
    const frontendUrl = resolveFrontendBaseUrl(req);
    res.redirect(`${frontendUrl}/dashboard?youtube=connected`);
  } catch (err) {
    throw new AppError('Failed to exchange authorization code for tokens', 500);
  }
});

// @desc    Disconnect YouTube account
// @route   POST /api/youtube/disconnect/:channelId?
// @access  Private
export const disconnectYouTube = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const channelId = req.params.channelId;

  if (channelId) {
    const initialLength = user.youtubeChannels.length;
    user.youtubeChannels = user.youtubeChannels.filter(c => c.channelId !== channelId);

    if (user.youtubeChannels.length === initialLength) {
        throw new AppError(`Channel ${channelId} not found`, 404);
    }
  } else {
    // Disconnect all
    user.youtubeChannels = [];
  }

  user.isYoutubeConnected = user.youtubeChannels.length > 0;

  user.markModified('youtubeChannels');
  await user.save();

  res.status(200).json({
    success: true,
    message: 'YouTube account(s) disconnected successfully',
  });
});
