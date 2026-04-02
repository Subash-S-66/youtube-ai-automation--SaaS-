import crypto from 'crypto';
import User from '../models/User';
import { AppError } from '../middleware/errorHandler';
import Plan from '../models/Plan';
import Payment from '../models/Payment';
import SystemConfig from '../models/SystemConfig';

type RazorpayPaymentLinkResponse = {
  short_url?: string;
  id?: string;
  status?: string;
  notes?: Record<string, string>;
  amount?: number;
  currency?: string;
};

type RazorpayOrderResponse = {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  receipt?: string;
  notes?: Record<string, string>;
};

const defaultPlanValue: Record<string, number> = { free: 0, basic: 1, pro: 2, premium: 4 };

const getPlanValueMap = async () => {
  const config = await SystemConfig.findOne().sort({ updatedAt: -1 });
  if (config?.planValueMap) {
    return {
      free: Number(config.planValueMap.free ?? 0),
      basic: Number(config.planValueMap.basic ?? 1),
      pro: Number(config.planValueMap.pro ?? 2),
      premium: Number(config.planValueMap.premium ?? 4),
    };
  }
  return defaultPlanValue;
};

const roundProratedDays = (days: number) => {
  const whole = Math.floor(days);
  const frac = days - whole;
  return whole + (frac >= 0.3 ? 1 : 0);
};

const getRemainingDays = (expiresAt?: Date | null) => {
  if (!expiresAt) return 0;
  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return diffMs / (1000 * 60 * 60 * 24);
};

const computeProrationDays = (currentPlan: string, targetPlan: string, remainingDays: number, planValueMap: Record<string, number>) => {
  const currentVal = planValueMap[String(currentPlan || '').toLowerCase()] ?? 0;
  const targetVal = planValueMap[String(targetPlan || '').toLowerCase()] ?? 0;
  if (currentVal <= 0 || targetVal <= 0 || remainingDays <= 0) return 0;
  const raw = remainingDays * (currentVal / targetVal);
  return roundProratedDays(raw);
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

const parseExpectedAmountPaise = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return Math.max(0, Math.floor(Number(fallback || 0)));
};

const ensureAmountNotUnderpaid = (paidAmountPaise: number, expectedAmountPaise: number, context: string) => {
  const safePaid = Math.max(0, Math.floor(Number(paidAmountPaise || 0)));
  const safeExpected = Math.max(0, Math.floor(Number(expectedAmountPaise || 0)));
  if (safeExpected <= 0) return;
  // Allow 1 paise tolerance for rounding/parsing edge cases.
  if (safePaid + 1 < safeExpected) {
    throw new AppError(`${context}: payment amount mismatch`, 400);
  }
};

export const createPaymentLink = async (userId: string, planId?: string): Promise<string> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Determine which plan they are buying
  const requestedPlanName = planId || 'pro';
  const currentPlanName = String(user.plan || '').toLowerCase();
  const requestedLower = String(requestedPlanName || '').toLowerCase();
  const planValueMap = await getPlanValueMap();
  const currentRank = planValueMap[currentPlanName] ?? 0;
  const requestedRank = planValueMap[requestedLower] ?? 0;

    const planObj = await Plan.findOne({ name: requestedPlanName, is_active: true });
  if (!planObj) {
      throw new AppError(`Plan '${requestedPlanName}' not found or inactive`, 404);
  }

  if (user.subscriptionStatus === 'active' && currentRank > requestedRank) {
    throw new AppError('You cannot purchase a lower plan while your subscription is active.', 400);
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

  // If finalPrice is truly 0 (either free plan, or 100% discount), amountPaise should just be 0
  // However Razorpay might reject 0 amount links. Let's allow it to be 0 or fallback if it's missing completely.
  const amountPaise = !Number.isNaN(calculatedPaise) ? calculatedPaise : Number(process.env.RAZORPAY_PLAN_AMOUNT_PAISE || 0);
  const currency = process.env.RAZORPAY_CURRENCY || 'INR';

  if (Number.isNaN(amountPaise)) {
    throw new AppError('Razorpay configuration missing or invalid amount', 500);
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
      expectedAmountPaise: String(amountPaise),
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

export const createOrder = async (userId: string, planId?: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const requestedPlanName = planId || 'pro';
  const currentPlanName = String(user.plan || '').toLowerCase();
  const requestedLower = String(requestedPlanName || '').toLowerCase();
  const planValueMap = await getPlanValueMap();
  const currentRank = planValueMap[currentPlanName] ?? 0;
  const requestedRank = planValueMap[requestedLower] ?? 0;
  const planObj = await Plan.findOne({ name: requestedPlanName, is_active: true });
  if (!planObj) {
    throw new AppError(`Plan '${requestedPlanName}' not found or inactive`, 404);
  }

  if (user.subscriptionStatus === 'active' && currentRank > requestedRank) {
    throw new AppError('You cannot purchase a lower plan while your subscription is active.', 400);
  }

  if (user.plan === requestedPlanName && user.subscriptionStatus === 'active') {
    throw new AppError(`User already has an active ${requestedPlanName} subscription`, 400);
  }

  const exchangeRate = 80;
  let finalPrice = planObj.price;
  if (planObj.discountPercentage && planObj.discountPercentage > 0) {
    finalPrice = finalPrice * (1 - planObj.discountPercentage / 100);
  }

  const calculatedPaise = Math.round(finalPrice * exchangeRate * 100);
  const amountPaise = !Number.isNaN(calculatedPaise) ? calculatedPaise : Number(process.env.RAZORPAY_PLAN_AMOUNT_PAISE || 0);
  const currency = process.env.RAZORPAY_CURRENCY || 'INR';

  if (Number.isNaN(amountPaise)) {
    throw new AppError('Razorpay configuration missing or invalid amount', 500);
  }

  const orderBody = {
    amount: amountPaise,
    currency,
    receipt: `${userId}-${Date.now()}`,
    notes: {
      userId,
      plan: planObj.name,
      expectedAmountPaise: String(amountPaise),
    },
  };

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: getRazorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new AppError(`Razorpay error: ${errText}`, 500);
  }

  const data = (await response.json()) as RazorpayOrderResponse;
  if (!data.id) {
    throw new AppError('Failed to create Razorpay order', 500);
  }

  const keyId = process.env.RAZORPAY_KEY_ID || '';

  return {
    orderId: data.id,
    amount: data.amount || amountPaise,
    currency: data.currency || currency,
    keyId,
    planName: planObj.name,
    email: user.email,
  };
};

export const createRenewOrder = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const currentPlan = String(user.plan || '').toLowerCase();
  if (currentPlan === 'free') {
    throw new AppError('Free plan cannot be renewed.', 400);
  }

  const planObj = await Plan.findOne({ name: currentPlan, is_active: true });
  if (!planObj) {
    throw new AppError(`Plan '${currentPlan}' not found or inactive`, 404);
  }

  const exchangeRate = 80;
  let finalPrice = planObj.price;
  if (planObj.discountPercentage && planObj.discountPercentage > 0) {
    finalPrice = finalPrice * (1 - planObj.discountPercentage / 100);
  }

  const calculatedPaise = Math.round(finalPrice * exchangeRate * 100);
  const amountPaise = !Number.isNaN(calculatedPaise) ? calculatedPaise : Number(process.env.RAZORPAY_PLAN_AMOUNT_PAISE || 0);
  const currency = process.env.RAZORPAY_CURRENCY || 'INR';

  if (Number.isNaN(amountPaise)) {
    throw new AppError('Razorpay configuration missing or invalid amount', 500);
  }

  const orderBody = {
    amount: amountPaise,
    currency,
    receipt: `${userId}-${Date.now()}`,
    notes: {
      userId,
      plan: planObj.name,
      renew: '1',
      expectedAmountPaise: String(amountPaise),
    },
  };

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: getRazorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new AppError(`Razorpay error: ${errText}`, 500);
  }

  const data = (await response.json()) as RazorpayOrderResponse;
  if (!data.id) {
    throw new AppError('Failed to create Razorpay order', 500);
  }

  const keyId = process.env.RAZORPAY_KEY_ID || '';

  return {
    orderId: data.id,
    amount: data.amount || amountPaise,
    currency: data.currency || currency,
    keyId,
    planName: planObj.name,
    email: user.email,
  };
};

type ApplyPaymentInput = {
  userId: string;
  purchasedPlan: string;
  amount: number;
  currency: string;
  transactionId: string;
  receiptUrl?: string | undefined;
  expectedAmountPaise?: number;
};

const applySuccessfulPayment = async ({
  userId,
  purchasedPlan,
  amount,
  currency,
  transactionId,
  receiptUrl,
  expectedAmountPaise,
}: ApplyPaymentInput) => {
  const existing = await Payment.findOne({ transactionId });
  if (existing) {
    return { alreadyProcessed: true, payment: existing };
  }

  ensureAmountNotUnderpaid(amount, Number(expectedAmountPaise || 0), 'Payment verification');

  const normalizedPurchasedPlan = String(purchasedPlan || '').toLowerCase();
  const planObj = await Plan.findOne({ name: normalizedPurchasedPlan, is_active: true });
  if (!planObj) {
    throw new AppError(`Invalid or inactive plan '${normalizedPurchasedPlan}' in payment payload`, 400);
  }

  const currentUser = await User.findById(userId);
  if (!currentUser) {
    throw new AppError('User not found when applying payment', 404);
  }

  const planValueMap = await getPlanValueMap();
  let creditDays = 0;
  if (currentUser.subscriptionStatus === 'active') {
    const remainingDays = getRemainingDays(currentUser.subscriptionExpiresAt || undefined);
    creditDays = computeProrationDays(currentUser.plan, purchasedPlan, remainingDays, planValueMap);
  }

  const totalDays = 30 + creditDays;
  const subscriptionExpiresAt = new Date();
  subscriptionExpiresAt.setDate(subscriptionExpiresAt.getDate() + totalDays);

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      plan: planObj.name,
      subscriptionStatus: 'active',
      subscriptionExpiresAt,
      uploadsUsedToday: 0,
    },
    { returnDocument: 'after' }
  );

  if (!updatedUser) {
    throw new AppError('User not found when applying payment', 404);
  }

  // Handle referral reward if applicable
  if (updatedUser.referredBy && !updatedUser.referralRewardGiven) {
    try {
      const referrer = await User.findById(updatedUser.referredBy);
      if (referrer) {
        // Extend referrer's subscription by 7 days
        const currentExpiry = referrer.subscriptionExpiresAt && referrer.subscriptionExpiresAt > new Date()
          ? referrer.subscriptionExpiresAt
          : new Date();
        const newExpiry = new Date(currentExpiry);
        newExpiry.setDate(newExpiry.getDate() + 7);

        referrer.subscriptionExpiresAt = newExpiry;
        referrer.subscriptionStatus = 'active';

        // Upgrade them to at least 'basic' if they are on 'free'
        if (!referrer.plan || referrer.plan === 'free') {
          referrer.plan = 'basic';
        }

        await referrer.save();

        // Mark reward as given for the new user
        updatedUser.referralRewardGiven = true;
        await updatedUser.save();
        console.log(`Successfully applied referral reward to user ${referrer._id} for referring ${updatedUser._id}`);
      }
    } catch (referralErr) {
      console.error('Failed to process referral reward:', referralErr);
      // We don't throw here to ensure the payment success still processes
    }
  }

  const paymentPayload: any = {
    userId: updatedUser._id,
    planId: planObj.name,
    amount: amount / 100, // Convert from paise/cents to standard unit
    currency,
    status: 'success',
    provider: 'razorpay',
    transactionId,
  };
  if (receiptUrl) {
    paymentPayload.receiptUrl = receiptUrl;
  }

  const payment = await Payment.create(paymentPayload);

  return { alreadyProcessed: false, payment, user: updatedUser };
};

type ConfirmInput = {
  paymentLinkId: string;
};

export const confirmPaymentLink = async (userId: string, input: ConfirmInput) => {
  const { paymentLinkId } = input;
  if (!paymentLinkId) {
    throw new AppError('Missing payment link id', 400);
  }

  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
    method: 'GET',
    headers: {
      Authorization: getRazorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new AppError(`Razorpay verification error: ${errText}`, 500);
  }

  const data = (await response.json()) as RazorpayPaymentLinkResponse;
  const status = String(data.status || '').toLowerCase();

  if (status !== 'paid') {
    throw new AppError('Payment not completed yet', 400);
  }

  const notes = data.notes || {};
  if (!notes.userId) {
    throw new AppError('Unable to verify payment owner', 400);
  }

  if (notes.userId !== userId) {
    throw new AppError('Payment does not belong to this user', 403);
  }

  const purchasedPlan = notes.plan || 'pro';
  const amount = data.amount || 0;
  const currency = data.currency || 'INR';
  const transactionId = data.id || paymentLinkId;
  const receiptUrl = data.short_url;
  const expectedAmountPaise = parseExpectedAmountPaise(notes.expectedAmountPaise, amount);

  return applySuccessfulPayment({
    userId,
    purchasedPlan,
    amount,
    currency,
    transactionId,
    receiptUrl,
    expectedAmountPaise,
  });
};

type ConfirmOrderPaymentInput = {
  orderId: string;
  paymentId: string;
  signature: string;
};

export const confirmOrderPayment = async (userId: string, input: ConfirmOrderPaymentInput) => {
  const { orderId, paymentId, signature } = input;
  if (!orderId || !paymentId || !signature) {
    throw new AppError('Missing Razorpay payment details', 400);
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new AppError('Razorpay is not configured', 500);
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new AppError('Invalid Razorpay signature', 400);
  }

  const response = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    method: 'GET',
    headers: {
      Authorization: getRazorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new AppError(`Razorpay verification error: ${errText}`, 500);
  }

  const data = (await response.json()) as RazorpayOrderResponse;
  const status = String(data.status || '').toLowerCase();
  if (status !== 'paid') {
    throw new AppError('Payment not completed yet', 400);
  }

  const notes = data.notes || {};
  if (!notes.userId) {
    throw new AppError('Unable to verify payment owner', 400);
  }

  if (notes.userId !== userId) {
    throw new AppError('Payment does not belong to this user', 403);
  }

  const purchasedPlan = notes.plan || 'pro';
  const amount = data.amount || 0;
  const currency = data.currency || 'INR';
  const expectedAmountPaise = parseExpectedAmountPaise(notes.expectedAmountPaise, amount);

  ensureAmountNotUnderpaid(amount, expectedAmountPaise, 'Order payment verification');
  const normalizedPurchasedPlan = String(purchasedPlan || '').toLowerCase();
  const planObj = await Plan.findOne({ name: normalizedPurchasedPlan, is_active: true });
  if (!planObj) {
    throw new AppError(`Invalid or inactive plan '${normalizedPurchasedPlan}' in payment payload`, 400);
  }

  if (String(notes.renew || '') === '1') {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found when renewing', 404);
    }
    const baseDate = user.subscriptionExpiresAt && user.subscriptionExpiresAt > new Date()
      ? new Date(user.subscriptionExpiresAt)
      : new Date();
    baseDate.setDate(baseDate.getDate() + 30);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        plan: planObj.name,
        subscriptionStatus: 'active',
        subscriptionExpiresAt: baseDate,
      },
      { returnDocument: 'after' }
    );

    return {
      renewed: true,
      user: updatedUser,
    };
  }

  return applySuccessfulPayment({
    userId,
    purchasedPlan: planObj.name,
    amount,
    currency,
    transactionId: paymentId,
    expectedAmountPaise,
  });
};

export const convertPlanWithRemaining = async (userId: string, targetPlan: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const currentPlan = String(user.plan || '').toLowerCase();
  const target = String(targetPlan || '').toLowerCase();
  const planValueMap = await getPlanValueMap();
  const currentRank = planValueMap[currentPlan] ?? 0;
  const targetRank = planValueMap[target] ?? 0;

  if (targetRank <= currentRank) {
    throw new AppError('You can only convert to a higher plan.', 400);
  }

  if (user.subscriptionStatus !== 'active') {
    throw new AppError('No active subscription to convert.', 400);
  }

  const remainingDays = getRemainingDays(user.subscriptionExpiresAt || undefined);
  const creditDays = computeProrationDays(currentPlan, target, remainingDays, planValueMap);
  if (creditDays <= 0) {
    throw new AppError('Not enough remaining days to convert.', 400);
  }

  const subscriptionExpiresAt = new Date();
  subscriptionExpiresAt.setDate(subscriptionExpiresAt.getDate() + creditDays);

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      plan: target,
      subscriptionStatus: 'active',
      subscriptionExpiresAt,
      uploadsUsedToday: 0,
    },
    { returnDocument: 'after' }
  );

  if (!updatedUser) {
    throw new AppError('User not found when applying conversion', 404);
  }

  return {
    converted: true,
    creditDays,
    user: updatedUser,
  };
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
    const expectedAmountPaise = parseExpectedAmountPaise(paymentLink?.notes?.expectedAmountPaise, amount);

    if (!transactionId) {
      console.error('Webhook event missing transaction ID', event);
      return;
    }

    if (userId) {
      try {
        const result = await applySuccessfulPayment({
          userId,
          purchasedPlan,
          amount,
          currency,
          transactionId,
          receiptUrl: paymentLink?.short_url,
          expectedAmountPaise,
        });
        if (!result.alreadyProcessed) {
          console.log(`Successfully processed Razorpay payment ${transactionId} for user ${userId}`);
        }
      } catch (error) {
        console.error('Failed to update user or create payment record on webhook:', error);
      }
    }
  }
};

// Stripe (legacy) logic kept in backend/src/services/stripeService.ts
