import crypto from 'crypto';
import User from '../models/User';
import { AppError } from '../middleware/errorHandler';

type RazorpayPaymentLinkResponse = {
  short_url?: string;
  id?: string;
  status?: string;
  notes?: Record<string, string>;
};

const getRazorpayAuthHeader = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new AppError('Razorpay is not configured', 500);
  }

  const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return `Basic ${token}`;
};

export const createPaymentLink = async (userId: string): Promise<string> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.plan === 'pro' && user.subscriptionStatus === 'active') {
    throw new AppError('User already has an active Pro subscription', 400);
  }

  const amountPaise = Number(process.env.RAZORPAY_PLAN_AMOUNT_PAISE || 0);
  const currency = process.env.RAZORPAY_CURRENCY || 'INR';

  if (!amountPaise || Number.isNaN(amountPaise)) {
    throw new AppError('Razorpay configuration missing', 500);
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const body = {
    amount: amountPaise,
    currency,
    description: 'ClipForge Pro Subscription',
    customer: {
      name: user.email,
      email: user.email,
    },
    reference_id: `${userId}-${Date.now()}`,
    callback_url: `${frontendUrl}/dashboard?payment=success`,
    callback_method: 'get',
    notes: {
      userId,
      plan: 'pro',
    },
  };

  const response = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: getRazorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new AppError(`Razorpay error: ${errText}`, 500);
  }

  const data = (await response.json()) as RazorpayPaymentLinkResponse;
  if (!data.short_url) {
    throw new AppError('Failed to create Razorpay payment link', 500);
  }

  return data.short_url;
};

export const handleRazorpayWebhook = async (rawBody: Buffer | string, signature: string) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new AppError('Razorpay webhook secret is not configured', 500);
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(bodyBuffer)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length) {
    throw new AppError('Invalid Razorpay signature', 400);
  }

  if (!crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new AppError('Invalid Razorpay signature', 400);
  }

  const payload = JSON.parse(bodyBuffer.toString('utf-8'));
  const event = payload.event as string | undefined;

  // Only handle successful payment link completions for now
  if (event === 'payment_link.paid') {
    const paymentLink = payload?.payload?.payment_link?.entity;
    const userId = paymentLink?.notes?.userId;

    if (userId) {
      const subscriptionExpiresAt = new Date();
      subscriptionExpiresAt.setDate(subscriptionExpiresAt.getDate() + 28);

      await User.findByIdAndUpdate(userId, {
        plan: 'pro',
        subscriptionStatus: 'active',
        subscriptionExpiresAt,
      });
    }
  }
};

// Stripe (legacy) logic kept in backend/src/services/stripeService.ts
