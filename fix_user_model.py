import re

with open('backend/src/models/User.ts', 'r') as f:
    content = f.read()

interface_adds = """  subscriptionStatus: 'active' | 'inactive';
  cancelAtPeriodEnd: boolean;
  stripeCustomerId?: string;
  referralCode: string;
  referredBy?: string;
  referralRewardGiven: boolean;"""

content = content.replace("  subscriptionStatus: 'active' | 'inactive';\n  stripeCustomerId?: string;", interface_adds)

schema_adds = """    subscriptionStatus: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'inactive',
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    stripeCustomerId: {
      type: String,
    },
    referralCode: {
      type: String,
      unique: true,
    },
    referredBy: {
      type: String,
    },
    referralRewardGiven: {
      type: Boolean,
      default: false,
    },"""

content = content.replace("""    subscriptionStatus: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'inactive',
    },
    stripeCustomerId: {
      type: String,
    },""", schema_adds)

with open('backend/src/models/User.ts', 'w') as f:
    f.write(content)

print("Updated User model")
