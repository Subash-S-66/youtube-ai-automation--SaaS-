import re

with open('backend/src/services/stripeService.ts', 'r') as f:
    content = f.read()

ref_logic = """
          const updatedUser = await User.findByIdAndUpdate(userId, {
            stripeCustomerId: session.customer as string,
            plan: 'pro',
            subscriptionStatus: 'active',
            subscriptionExpiresAt,
          }, { new: true });

          if (updatedUser && updatedUser.referredBy && !updatedUser.referralRewardGiven) {
             const referrer = await User.findById(updatedUser.referredBy);
             if (referrer) {
                const currentExpiry = referrer.subscriptionExpiresAt && referrer.subscriptionExpiresAt > new Date() ? referrer.subscriptionExpiresAt : new Date();
                currentExpiry.setDate(currentExpiry.getDate() + 7);
                referrer.subscriptionExpiresAt = currentExpiry;
                if (referrer.plan === 'free') referrer.plan = 'basic';
                referrer.subscriptionStatus = 'active';
                await referrer.save();
                updatedUser.referralRewardGiven = true;
                await updatedUser.save();
             }
          }
"""

content = re.sub(
    r'          await User\.findByIdAndUpdate\(userId, \{\n            stripeCustomerId: session\.customer as string,\n            plan: \'pro\',\n            subscriptionStatus: \'active\',\n            subscriptionExpiresAt,\n          \}\);',
    ref_logic,
    content,
    flags=re.DOTALL
)

with open('backend/src/services/stripeService.ts', 'w') as f:
    f.write(content)

print("Updated stripe webhook for referrals")
