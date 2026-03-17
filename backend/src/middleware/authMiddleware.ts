import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from './errorHandler';

interface DecodedToken {
  id: string;
}

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token = '';

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1] || '';

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

      req.user = user;

      return next();
    } catch (error) {
      return next(new AppError('Not authorized, token failed', 401));
    }
  }

  if (!token) {
    return next(new AppError('Not authorized, no token', 401));
  }
});
