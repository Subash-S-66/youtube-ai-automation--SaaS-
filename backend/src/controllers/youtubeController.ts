import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { getGoogleAuthUrl, exchangeCodeForTokens } from '../services/youtubeOAuthService';
import User from '../models/User';

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
  const authUrl = getGoogleAuthUrl(stateToken);

  // Redirect user to Google OAuth consent screen
  res.redirect(authUrl);
});

// @desc    YouTube OAuth callback
// @route   GET /api/youtube/callback
// @access  Private (protected by state token via middleware)
export const youtubeCallback = asyncHandler(async (req: Request, res: Response) => {
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
    const tokens = await exchangeCodeForTokens(code);

    const user = await User.findById(req.user.id);
    if (!user) {
        throw new AppError('User not found', 404);
    }

    // Save tokens in MongoDB
    user.set('youtubeTokens', {
        access_token: tokens.access_token || undefined,
        refresh_token: tokens.refresh_token || undefined,
        expiry_date: tokens.expiry_date || undefined,
    });
    user.isYoutubeConnected = true;

    await user.save();

    // Redirect to frontend (placeholder)
    // Replace this with the actual frontend URL once built
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard?youtube=connected`);
  } catch (err) {
    throw new AppError('Failed to exchange authorization code for tokens', 500);
  }
});

// @desc    Disconnect YouTube account
// @route   POST /api/youtube/disconnect
// @access  Private
export const disconnectYouTube = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Remove tokens and update status
  user.set('youtubeTokens', undefined);
  user.isYoutubeConnected = false;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'YouTube account disconnected successfully',
  });
});
