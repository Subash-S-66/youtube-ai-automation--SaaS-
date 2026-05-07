import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { createOrder, createRenewOrder, handleRazorpayWebhook, confirmPaymentLink, confirmOrderPayment, convertPlanWithRemaining } from '../services/razorpayService';

// @desc    Create Razorpay payment link
// @route   POST /api/payment/create-checkout
// @access  Private
export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const { planId } = req.body;

  const order = await createOrder(req.user.id, planId);

  res.status(200).json({
    success: true,
    data: order,
  });
});

// @desc    Create Razorpay order for renewal
// @route   POST /api/payment/renew
// @access  Private
export const createRenewal = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const order = await createRenewOrder(req.user.id);

  res.status(200).json({
    success: true,
    data: order,
  });
});

// @desc    Confirm Razorpay payment after callback
// @route   POST /api/payment/confirm
// @access  Private
export const confirmCheckout = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const {
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
  } = req.body || {};

  if (razorpay_payment_id && razorpay_order_id && razorpay_signature) {
    const result = await confirmOrderPayment(req.user.id, {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
    return;
  }

  const {
    payment_link_id,
    razorpay_payment_link_id,
    paymentLinkId,
  } = req.body || {};

  const resolvedPaymentLinkId =
    payment_link_id ||
    razorpay_payment_link_id ||
    paymentLinkId;

  if (!resolvedPaymentLinkId) {
    throw new AppError('Missing payment link id', 400);
  }

  const result = await confirmPaymentLink(req.user.id, {
    paymentLinkId: resolvedPaymentLinkId,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

// @desc    Convert current plan to a higher plan using remaining days only
// @route   POST /api/payment/convert
// @access  Private
export const convertPlan = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const { targetPlan } = req.body || {};
  if (!targetPlan) {
    throw new AppError('targetPlan is required', 400);
  }

  const result = await convertPlanWithRemaining(req.user.id, targetPlan);

  res.status(200).json({
    success: true,
    data: result,
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
