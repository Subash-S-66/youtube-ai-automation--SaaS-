import re

with open('backend/src/services/razorpayService.ts', 'r') as f:
    content = f.read()

ref_logic = """
      const updatedUser = await User.findByIdAndUpdate(userId, {
        plan: planId,
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
    r'      await User\.findByIdAndUpdate\(userId, \{\n        plan: planId,\n        subscriptionStatus: \'active\',\n        subscriptionExpiresAt,\n      \}\);',
    ref_logic,
    content,
    flags=re.DOTALL
)

with open('backend/src/services/razorpayService.ts', 'w') as f:
    f.write(content)

print("Updated razorpay webhook for referrals")
