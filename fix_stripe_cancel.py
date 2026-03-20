import re

with open('backend/src/services/stripeService.ts', 'r') as f:
    content = f.read()

# Add handling for customer.subscription.updated to catch cancel_at_period_end
cancel_block = """      case 'customer.subscription.updated': {
        const subscription = dataObject as Stripe.Subscription;
        const customerId = subscription.customer as string;

        if (customerId) {
          const cancelAtPeriodEnd = subscription.cancel_at_period_end;
          await User.findOneAndUpdate(
            { stripeCustomerId: customerId },
            { cancelAtPeriodEnd }
          );
          console.log(`[Stripe] Subscription updated for ${customerId}. Cancel at end: ${cancelAtPeriodEnd}`);
        }
        break;
      }

      case 'customer.subscription.deleted':"""

content = content.replace("      case 'customer.subscription.deleted':", cancel_block)

with open('backend/src/services/stripeService.ts', 'w') as f:
    f.write(content)

print("Updated stripe for cancelAtPeriodEnd")
