import re

with open('backend/src/controllers/authController.ts', 'r') as f:
    content = f.read()

# Fix strict undefined type mapping
create_reg = """    let referredBy: string | undefined = undefined;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) referredBy = referrer._id as string;
    }"""

content = content.replace("""    let referredBy;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) referredBy = referrer.id;
    }""", create_reg)

create_code = """    const createPayload: any = {
      email,
      password: hashedPassword,
      emailVerificationToken: hashedVerificationToken,
      emailVerificationExpires: verificationExpires,
      referralCode: myReferralCode,
    };
    if (referredBy) createPayload.referredBy = referredBy;

    const user = await User.create(createPayload);"""

content = re.sub(r'    const user = await User\.create\(\{\n      email,\n      password: hashedPassword,\n      emailVerificationToken: hashedVerificationToken,\n      emailVerificationExpires: verificationExpires,\n      referralCode: myReferralCode,\n      referredBy,\n    \}\);', create_code, content)


# Fix strict undefined type mapping for google oauth
create_goo = """    let referredBy: string | undefined = undefined;
    if (stateStr && stateStr.startsWith('ref:')) {
      const refCode = stateStr.split(':')[1];
      if (refCode) {
        const referrer = await User.findOne({ referralCode: refCode });
        if (referrer) referredBy = referrer._id as string;
      }
    }"""

content = re.sub(
r"    let referredBy;\n    if \(stateStr && stateStr\.startsWith\('ref:'\)\) \{\n      const refCode = stateStr\.split\(':'\)\[1\];\n      const referrer = await User\.findOne\(\{ referralCode: refCode \}\);\n      if \(referrer\) referredBy = referrer\.id;\n    \}",
create_goo, content)

goo_create = """    const createPayload: any = {
      email: data.email,
      provider: 'google',
      isEmailVerified: true, // Auto-verified by Google
      referralCode: myReferralCode,
    };
    if (referredBy) createPayload.referredBy = referredBy;"""

content = re.sub(r"    const createPayload: any = \{\n      email: data\.email,\n      provider: 'google',\n      isEmailVerified: true, // Auto-verified by Google\n      referralCode: myReferralCode,\n      referredBy,\n    \};", goo_create, content)

with open('backend/src/controllers/authController.ts', 'w') as f:
    f.write(content)

print("Fixed TS compilation for referrers")
