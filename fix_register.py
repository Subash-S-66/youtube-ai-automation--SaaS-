import re

with open('backend/src/utils/validators/authValidators.ts', 'r') as f:
    content = f.read()

content = content.replace("  body: z.object({\n    email: z", "  body: z.object({\n    referralCode: z.string().optional(),\n    email: z")

with open('backend/src/utils/validators/authValidators.ts', 'w') as f:
    f.write(content)

with open('backend/src/controllers/authController.ts', 'r') as f:
    content = f.read()

reg = """    const { email, password, referralCode } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });

    if (userExists) {
      throw new AppError('User already exists', 400);
    }

    // Generate own referral code
    const myReferralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    let referredBy;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) referredBy = referrer.id;
    }

    // Hash password"""

content = re.sub(
    r'    const \{ email, password \} = req\.body;\n\n    // Check if user exists\n    const userExists = await User\.findOne\(\{ email \}\);\n\n    if \(userExists\) \{\n      throw new AppError\(\'User already exists\', 400\);\n    \}\n\n    // Hash password',
    reg,
    content,
    flags=re.DOTALL
)

create_code = """    // Create user
    const user = await User.create({
      email,
      password: hashedPassword,
      emailVerificationToken: hashedVerificationToken,
      emailVerificationExpires: verificationExpires,
      referralCode: myReferralCode,
      referredBy,
    });"""

content = re.sub(
    r'    // Create user\n    const user = await User\.create\(\{\n      email,\n      password: hashedPassword,\n      emailVerificationToken: hashedVerificationToken,\n      emailVerificationExpires: verificationExpires,\n    \}\);',
    create_code,
    content,
    flags=re.DOTALL
)

with open('backend/src/controllers/authController.ts', 'w') as f:
    f.write(content)

print("Updated registration logic for referrals")
