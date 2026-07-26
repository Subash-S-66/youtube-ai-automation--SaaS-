import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import GlobalBanner from '../models/GlobalBanner';

export const getActiveBanner = asyncHandler(async (req: Request, res: Response) => {
  const banners = await GlobalBanner.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  const now = new Date();

  const activeBanners = banners.filter((b) => {
    const isStarted = !b.startAt || now >= b.startAt;
    const isNotEnded = !b.endAt || now <= b.endAt;
    return isStarted && isNotEnded;
  });

  res.status(200).json({
    success: true,
    data: activeBanners.length > 0 ? activeBanners : null,
    banners: activeBanners,
  });
});
