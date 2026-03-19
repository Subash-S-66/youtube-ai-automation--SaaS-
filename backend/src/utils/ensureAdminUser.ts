import bcrypt from 'bcrypt';
import User from '../models/User';

export const ensureAdminUser = async (): Promise<void> => {
  const username = process.env.ADMIN_LOGIN_USERNAME;
  const password = process.env.ADMIN_LOGIN_PASSWORD;

  if (!username || !password) {
    console.warn('Admin login credentials missing. Set ADMIN_LOGIN_USERNAME and ADMIN_LOGIN_PASSWORD to enable admin login.');
    return;
  }

  const existing = await User.findOne({ email: username });
  const hashedPassword = await bcrypt.hash(password, 10);

  if (existing) {
    let updated = false;
    if (existing.role !== 'admin') {
      existing.role = 'admin';
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

  await User.create({
    email: username,
    password: hashedPassword,
    role: 'admin',
    isEmailVerified: true,
    provider: 'local',
  });
  console.log('Admin user created.');
};

