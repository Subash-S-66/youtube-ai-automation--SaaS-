import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import Plan from '../models/Plan';

// @desc    Get all public plans
// @route   GET /api/plans
// @access  Public
export const getPublicPlans = asyncHandler(async (req: Request, res: Response) => {
  const plans = await Plan.find({ is_active: true })
    .select('name price discountPercentage features limits featuresList')
    .sort({ price: 1 });

  res.status(200).json({
    success: true,
    data: plans,
  });
});
