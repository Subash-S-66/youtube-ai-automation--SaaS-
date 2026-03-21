import re

# Update pricing/page.tsx
with open('frontend/src/app/pricing/page.tsx', 'r') as f:
    content = f.read()

new_plans = """const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0/mo',
    limit: 2,
    features: ['2 video uploads per day', '1 YouTube channel', 'Basic AI generation', 'Standard voices', 'No scheduling / No Story Mode'],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '$10/mo',
    limit: 10,
    features: ['10 video uploads per day', '3 YouTube channels', 'Faster AI generation', 'Story Mode & Scheduling enabled', 'Email support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$25/mo',
    limit: 25,
    features: ['25 video uploads per day', '10 YouTube channels', 'Priority generation queue', 'Premium AI voices', 'Priority support'],
    recommended: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '$99/mo',
    limit: 100,
    features: ['100 video uploads per day', '50 YouTube channels', 'Instant generation queue', 'All AI voices unlocked', '24/7 dedicated support', 'Custom templates'],
  }
];"""

content = re.sub(
    r'const PLANS: Plan\[\] = \[.*?\];',
    new_plans,
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/pricing/page.tsx', 'w') as f:
    f.write(content)

# Update payments/page.tsx
with open('frontend/src/app/payments/page.tsx', 'r') as f:
    content2 = f.read()

content2 = re.sub(
    r'const PLANS: Plan\[\] = \[.*?\];',
    new_plans,
    content2,
    flags=re.DOTALL
)

with open('frontend/src/app/payments/page.tsx', 'w') as f:
    f.write(content2)

print("Updated pricing and payment pages UI details")
