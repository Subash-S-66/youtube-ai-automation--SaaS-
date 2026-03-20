import re

with open('backend/src/controllers/authController.ts', 'r') as f:
    content = f.read()

# Grab state parameter from google callback to get referral code if passed
google_create = """  } else {
    // Create Google User
    const stateStr = req.query.state as string;
    let referredBy;
    if (stateStr && stateStr.startsWith('ref:')) {
      const refCode = stateStr.split(':')[1];
      const referrer = await User.findOne({ referralCode: refCode });
      if (referrer) referredBy = referrer.id;
    }
    const myReferralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const createPayload: any = {
      email: data.email,
      provider: 'google',
      isEmailVerified: true, // Auto-verified by Google
      referralCode: myReferralCode,
      referredBy,
    };"""

content = re.sub(
    r'  \} else \{\n    // Create Google User\n    const createPayload: any = \{\n      email: data\.email,\n      provider: \'google\',\n      isEmailVerified: true, // Auto-verified by Google\n    \};',
    google_create,
    content,
    flags=re.DOTALL
)

with open('backend/src/controllers/authController.ts', 'w') as f:
    f.write(content)

print("Updated Google OAuth registration for referrals")
