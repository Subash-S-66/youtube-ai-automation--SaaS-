import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { createCheckoutSession, handleWebhook } from '../services/stripeService';

// @desc    Create Stripe checkout session
// @route   POST /api/payment/create-checkout
// @access  Private
export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const url = await createCheckoutSession(req.user.id);

  res.status(200).json({
    success: true,
    url,
  });
});

// @desc    Stripe webhook handler
// @route   POST /api/payment/webhook
// @access  Public
export const webhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    throw new AppError('Missing Stripe signature', 400);
  }

  // Handle webhook (this logic should use the raw body, which will be setup in app.ts)
  await handleWebhook(req.body, signature as string);

  // Return a 200 response to acknowledge receipt of the event
  res.status(200).json({ received: true });
});
