import bcrypt from 'bcrypt';
import crypto from 'crypto';
import User from '../models/User';

const generateReferralCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const backfillMissingReferralCodes = async () => {
  const users = await User.find({
    $or: [{ referralCode: { $exists: false } }, { referralCode: null }, { referralCode: '' }],
  }).select('_id referralCode');

  for (const user of users) {
    let updated = false;
    for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
      try {
        user.referralCode = generateReferralCode();
        await user.save();
        updated = true;
      } catch (err: any) {
        if (err?.code !== 11000) {
          throw err;
        }
      }
    }
  }
};

export const ensureAdminUser = async (): Promise<void> => {
  const username = process.env.ADMIN_LOGIN_USERNAME;
  const password = process.env.ADMIN_LOGIN_PASSWORD;

  if (!username || !password) {
    console.warn('Admin login credentials missing. Set ADMIN_LOGIN_USERNAME and ADMIN_LOGIN_PASSWORD to enable admin login.');
    return;
  }

  // Make sure there are no users with missing referral codes (unique index).
  await backfillMissingReferralCodes();

  const existing = await User.findOne({ email: username });
  const hashedPassword = await bcrypt.hash(password, 10);

  const newReferralCode = generateReferralCode();

  if (existing) {
    let updated = false;
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      updated = true;
    }
    if (!existing.referralCode) {
      existing.referralCode = newReferralCode;
      updated = true;
    }
    if (!existing.isEmailVerified) {
      existing.isEmailVerified = true;
      updated = true;
    }
    if (existing.password && !(await bcrypt.compare(password, existing.password))) {
      existing.password = hashedPassword;
      updated = true;
    }
    if (updated) {
      await existing.save();
      console.log('Admin user updated.');
    }
    return;
  }

  try {
    await User.create({
      email: username,
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
      provider: 'local',
      referralCode: newReferralCode,
    });
    console.log('Admin user created.');
  } catch (err: any) {
    if (err?.code === 11000) {
      await backfillMissingReferralCodes();
      await User.create({
        email: username,
        password: hashedPassword,
        role: 'admin',
        isEmailVerified: true,
        provider: 'local',
        referralCode: generateReferralCode(),
      });
      console.log('Admin user created.');
      return;
    }
    throw err;
  }
};
