import { Request, Response, NextFunction } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from './errorHandler';

export const adminMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    throw new AppError('Not authorized as an admin', 403);
  }
});
