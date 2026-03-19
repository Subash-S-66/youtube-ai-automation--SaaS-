import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import GlobalBanner from '../models/GlobalBanner';

export const getActiveBanner = asyncHandler(async (req: Request, res: Response) => {
  const banner = await GlobalBanner.findOne();

  let isActiveNow = false;

  if (banner && banner.isActive) {
    const now = new Date();
    const isStarted = !banner.startAt || now >= banner.startAt;
    const isNotEnded = !banner.endAt || now <= banner.endAt;

    if (isStarted && isNotEnded) {
      isActiveNow = true;
    }
  }

  res.status(200).json({
    success: true,
    data: isActiveNow ? banner : null,
  });
});
