import { Request, Response, NextFunction } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from './errorHandler';

const SUPPORT_STAFF_ROLES = new Set(['admin', 'helper']);

export const adminMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    throw new AppError('Not authorized as an admin', 403);
  }
});

export const supportStaffMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (SUPPORT_STAFF_ROLES.has(role)) {
    next();
    return;
  }

  throw new AppError('Not authorized as support staff', 403);
});
