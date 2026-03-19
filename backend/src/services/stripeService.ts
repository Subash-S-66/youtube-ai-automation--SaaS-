import Stripe from 'stripe';
import User from '../models/User';
import { AppError } from '../middleware/errorHandler';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {});

/**
 * Creates a Stripe Checkout Session for a user to upgrade to Pro plan.
 */
export const createCheckoutSession = async (userId: string): Promise<string> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.plan === 'pro' && user.subscriptionStatus === 'active') {
    throw new AppError('User already has an active Pro subscription', 400);
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new AppError('Stripe configuration missing', 500);
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const sessionConfig: Stripe.Checkout.SessionCreateParams = {
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${frontendUrl}/dashboard?payment=success`,
    cancel_url: `${frontendUrl}/dashboard?payment=cancelled`,
    client_reference_id: userId,
  };

  // Only pass customer if it exists, otherwise customer_email
  if (user.stripeCustomerId) {
    sessionConfig.customer = user.stripeCustomerId;
  } else {
    sessionConfig.customer_email = user.email;
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);

  if (!session.url) {
    throw new AppError('Failed to create checkout session', 500);
  }

  return session.url;
};

/**
 * Webhook handler for processing Stripe events asynchronously
 */
export const handleWebhook = async (body: Buffer | string, signature: string) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret is not configured');
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    throw new AppError(`Webhook Error: ${err.message}`, 400);
  }

  const dataObject = event.data.object as any;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = dataObject as Stripe.Checkout.Session;
        const userId = session.client_reference_id;

        if (userId) {
          const subscriptionExpiresAt = new Date();
          subscriptionExpiresAt.setDate(subscriptionExpiresAt.getDate() + 28);

          await User.findByIdAndUpdate(userId, {
            stripeCustomerId: session.customer as string,
            plan: 'pro',
            subscriptionStatus: 'active',
            subscriptionExpiresAt,
          });
          console.log(`[Stripe] Checkout completed. User ${userId} upgraded to Pro.`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = dataObject as Stripe.Invoice;
        const customerId = invoice.customer as string;

        if (customerId) {
          const subscriptionExpiresAt = new Date();
          subscriptionExpiresAt.setDate(subscriptionExpiresAt.getDate() + 28);

          await User.findOneAndUpdate(
            { stripeCustomerId: customerId },
            {
              plan: 'pro',
              subscriptionStatus: 'active',
              subscriptionExpiresAt,
            }
          );
          console.log(`[Stripe] Invoice paid for customer ${customerId}. Subscription active.`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = dataObject as Stripe.Invoice;
        const customerId = invoice.customer as string;

        if (customerId) {
          await User.findOneAndUpdate(
            { stripeCustomerId: customerId },
            {
              plan: 'free',
              subscriptionStatus: 'inactive',
              $unset: { subscriptionExpiresAt: 1 },
            }
          );
          console.warn(`[Stripe] Invoice failed for customer ${customerId}. Subscription inactive.`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = dataObject as Stripe.Subscription;
        const customerId = subscription.customer as string;

        if (customerId) {
          await User.findOneAndUpdate(
            { stripeCustomerId: customerId },
            {
              plan: 'free',
              subscriptionStatus: 'inactive',
              $unset: { subscriptionExpiresAt: 1 },
            }
          );
          console.log(`[Stripe] Subscription deleted for customer ${customerId}. Reverted to Free plan.`);
        }
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[Stripe] Error handling event ${event.type}:`, error);
    // Don't throw here to acknowledge the event back to Stripe even if DB updates fail
  }
};
