import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import GlobalBanner from '../models/GlobalBanner';

export const getActiveBanner = asyncHandler(async (req: Request, res: Response) => {
  const banner = await GlobalBanner.findOne({ isActive: true }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: banner, // can be null if no active banner
  });
});
