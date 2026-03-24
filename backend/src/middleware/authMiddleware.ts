import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from './errorHandler';
import { checkAndUpdateUserPlan } from '../utils/subscriptionHelper';

interface DecodedToken {
  id: string;
}

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token = '';

  // Get token from Authorization header (Bearer token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1] || '';
  }
  // Get token from short-lived state parameter (e.g. for OAuth callback)
  // DEPRECATED: Do not use req.query.state for tokens as it logs them in server access logs
  // else if (req.query.state && typeof req.query.state === 'string') {
  //   token = req.query.state;
  // }
  // Get token from cookies
  else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }
  // Use a dedicated short-lived cookie for OAuth
  else if (req.cookies && req.cookies.oauth_state) {
    token = req.cookies.oauth_state;
  }

  if (token) {
    try {
      const secret = process.env.JWT_SECRET as string;
      if (!secret) {
        throw new Error('JWT_SECRET is not defined');
      }

      // Verify token
      const decoded = jwt.verify(token, secret) as unknown as DecodedToken;

      // Get user from the token
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      // Automatically update plan if expired
      req.user = await checkAndUpdateUserPlan(user);

      return next();
    } catch (error) {
      return next(new AppError('Not authorized, token failed', 401));
    }
  }

  if (!token) {
    return next(new AppError('Not authorized, no token', 401));
  }
});
