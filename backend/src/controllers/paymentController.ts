import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { createPaymentLink, handleRazorpayWebhook } from '../services/razorpayService';

// @desc    Create Razorpay payment link
// @route   POST /api/payment/create-checkout
// @access  Private
export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const url = await createPaymentLink(req.user.id);

  res.status(200).json({
    success: true,
    url,
  });
});

// @desc    Razorpay webhook handler
// @route   POST /api/payment/webhook
// @access  Public
export const webhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!signature) {
    throw new AppError('Missing Razorpay signature', 400);
  }

  // Handle webhook (this logic should use the raw body, which will be setup in app.ts)
  await handleRazorpayWebhook(req.body, signature as string);

  // Return a 200 response to acknowledge receipt of the event
  res.status(200).json({ received: true });
});

// Stripe (legacy) logic kept for reference:
// import { createCheckoutSession, handleWebhook } from '../services/stripeService';
// const url = await createCheckoutSession(req.user.id);
// const signature = req.headers['stripe-signature'];
// await handleWebhook(req.body, signature as string);
