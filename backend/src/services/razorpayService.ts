import crypto from 'crypto';
import User from '../models/User';
import { AppError } from '../middleware/errorHandler';
import Plan from '../models/Plan';
import Payment from '../models/Payment';

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

export const createPaymentLink = async (userId: string, planId?: string): Promise<string> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Determine which plan they are buying
  const requestedPlanName = planId || 'pro';

  const planObj = await Plan.findOne({ name: requestedPlanName });
  if (!planObj) {
      throw new AppError(`Plan '${requestedPlanName}' not found`, 404);
  }

  if (user.plan === requestedPlanName && user.subscriptionStatus === 'active') {
    throw new AppError(`User already has an active ${requestedPlanName} subscription`, 400);
  }

  // Calculate amount in paise considering the discount.
  // For Razorpay INR, assume price is in USD, 1 USD ~ 80 INR
  const exchangeRate = 80;
  let finalPrice = planObj.price;

  if (planObj.discountPercentage && planObj.discountPercentage > 0) {
    finalPrice = finalPrice * (1 - planObj.discountPercentage / 100);
  }

  const calculatedPaise = Math.round(finalPrice * exchangeRate * 100);

  // Fallback to env var if calculated amount is 0
  const amountPaise = calculatedPaise > 0 ? calculatedPaise : Number(process.env.RAZORPAY_PLAN_AMOUNT_PAISE || 0);
  const currency = process.env.RAZORPAY_CURRENCY || 'INR';

  if (!amountPaise || Number.isNaN(amountPaise)) {
    throw new AppError('Razorpay configuration missing', 500);
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const body = {
    amount: amountPaise,
    currency,
    description: `ClipForge ${planObj.name} Subscription`,
    customer: {
      name: user.email,
      email: user.email,
    },
    reference_id: `${userId}-${Date.now()}`,
    callback_url: `${frontendUrl}/dashboard?payment=success`,
    callback_method: 'get',
    notes: {
      userId,
      plan: planObj.name,
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
    const purchasedPlan = paymentLink?.notes?.plan || 'pro';
    const amount = paymentLink?.amount || 0;
    const currency = paymentLink?.currency || 'INR';
    const transactionId = paymentLink?.id;

    if (!transactionId) {
      console.error('Webhook event missing transaction ID', event);
      return;
    }

    if (userId) {
      try {
        const subscriptionExpiresAt = new Date();
        subscriptionExpiresAt.setDate(subscriptionExpiresAt.getDate() + 30);

        const updatedUser = await User.findByIdAndUpdate(userId, {
          plan: purchasedPlan,
          subscriptionStatus: 'active',
          subscriptionExpiresAt,
          uploadsUsedToday: 0, // Reset usage today on new subscription purchase
        }, { new: true });

        if (updatedUser) {
           await Payment.create({
             userId: updatedUser._id,
             planId: purchasedPlan,
             amount: amount / 100, // Convert from paise/cents to standard unit
             currency,
             status: 'success',
             provider: 'razorpay',
             transactionId,
             receiptUrl: paymentLink?.short_url
           });
           console.log(`Successfully processed Razorpay payment ${transactionId} for user ${userId}`);
        } else {
           console.error(`User ${userId} not found when processing Razorpay payment ${transactionId}`);
        }
      } catch (error) {
        console.error('Failed to update user or create payment record on webhook:', error);
      }
    }
  }
};

// Stripe (legacy) logic kept in backend/src/services/stripeService.ts
