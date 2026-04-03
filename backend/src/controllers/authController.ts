import { Request, Response } from 'express';
import User from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RegisterInput, LoginInput, AdminLoginInput, ForgotPasswordInput, ResetPasswordInput, ResendVerificationInput, SendOtpInput, VerifyOtpInput } from '../utils/validators/authValidators';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { sendEmail, sendEmailStrict } from '../services/emailService';
import { getUploadLimits } from '../services/uploadLimitService';
import { google } from 'googleapis';
import validator from 'validator';

const decodeUrlValue = (value: string): string => {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
};

const normalizeBaseUrl = (value: string): string => {
  const decoded = decodeUrlValue(value || '');
  const withoutQuotes = decoded.replace(/^['"]+|['"]+$/g, '');
  // A valid URL never contains spaces; strip them to guard against malformed env injection.
  const compact = withoutQuotes.replace(/\s+/g, '').trim();
  return compact.replace(/\/+$/, '');
};

const getFrontendBaseUrl = () => {
  const frontendCandidates = [
    process.env.FRONTEND_URL,
    process.env.FRONTEND_URLS?.split(',')[0],
  ];
  const resolved = frontendCandidates
    .map((value) => normalizeBaseUrl(value || ''))
    .find((value) => value.length > 0);

  return resolved || 'http://localhost:3000';
};

const getConfiguredBackendBaseUrl = () => {
  const resolved = normalizeBaseUrl(process.env.BACKEND_URL || '');
  return resolved || 'http://localhost:5000';
};

const resolveBackendBaseUrl = (req?: Request) => {
  const configuredFallback = getConfiguredBackendBaseUrl();
  if (!req) {
    return configuredFallback;
  }

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host');

  if (!host) {
    return configuredFallback;
  }

  const protocol = forwardedProto || (req.secure ? 'https' : req.protocol || 'http');
  return normalizeBaseUrl(`${protocol}://${host}`);
};

const oauthCookieSameSite: 'none' | 'lax' = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
const oauthCookieSecure = process.env.NODE_ENV === 'production';
const authCookieSecure = process.env.NODE_ENV === 'production';
const authCookieSameSite: 'lax' = 'lax';
const authCookieMaxAge = 7 * 24 * 60 * 60 * 1000;

const setOauthStateCookie = (res: Response, stateValue: string) => {
  res.cookie('oauth_state', stateValue, {
    httpOnly: true,
    secure: oauthCookieSecure,
    sameSite: oauthCookieSameSite,
    maxAge: 10 * 60 * 1000,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
};

const clearOauthStateCookie = (res: Response) => {
  res.cookie('oauth_state', '', {
    httpOnly: true,
    expires: new Date(0),
    secure: oauthCookieSecure,
    sameSite: oauthCookieSameSite,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
};

const isTimingSafeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

// Generate JWT
const generateToken = (id: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined');
  }

  return jwt.sign({ id }, secret, {
    expiresIn: '7d',
  });
};

// Helper to set HTTP-only cookie for JWT
const setTokenCookie = (res: Response, token: string, isOAuth: boolean = false) => {
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
    maxAge: authCookieMaxAge,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
};

const getGoogleOAuth2Client = (req?: Request) => {
  const backendUrl = normalizeBaseUrl(resolveBackendBaseUrl(req));
  const callbackUrl = `${backendUrl}/api/auth/google/callback`;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET,
    callbackUrl
  );
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
export const register = asyncHandler(
  async (req: Request<unknown, unknown, RegisterInput>, res: Response) => {
    const { email, password, referralCode } = req.body;

    if (!validator.isEmail(email)) {
      throw new AppError('Enter a valid email address', 400);
    }

    // Check if user exists
    const userExists = await User.findOne({ email });

    if (userExists) {
      if (!userExists.isEmailVerified) {
        throw new AppError('Please verify your email first', 400);
      }
      throw new AppError('Email already registered', 400);
    }

    // Generate own referral code
    const myReferralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    let referredBy: string | undefined = undefined;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) referredBy = referrer._id.toString();
    }

    // Create verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

    // Set expiry 15 minutes
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    // Send email
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
    const emailMessage = `Click to verify your email: \n\n ${verificationUrl}`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <p>Click the button below to verify your email:</p>
        <p>
          <a href="${verificationUrl}" style="display:inline-block;padding:10px 16px;background:#7C5CFF;color:#fff;text-decoration:none;border-radius:6px;">
            Verify Email
          </a>
        </p>
        <p style="font-size:12px;color:#6B7280;">If the button doesn't work, copy and paste this link:</p>
        <p style="font-size:12px;color:#6B7280;">${verificationUrl}</p>
      </div>
    `;

    try {
      await sendEmailStrict(email, 'Verify your email', emailMessage, emailHtml);
    } catch (error) {
      throw new AppError('This email does not exist or cannot receive emails', 400);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const createPayload: any = {
      email,
      password: hashedPassword,
      role: 'user', // Enforce strict default role to prevent privilege escalation via body injections
      isEmailVerified: false,
      emailVerificationToken: hashedVerificationToken,
      emailVerificationExpires: verificationExpires,
      referralCode: myReferralCode,
    };
    if (referredBy) createPayload.referredBy = referredBy;

    const user = await User.create(createPayload);

    if (!user) {
      throw new AppError('Invalid user data', 400);
    }

    // Don't generate JWT or set cookie yet, as they must verify email first
    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please check your email to verify your account.',
      data: {
        _id: user.id,
        email: user.email,
        role: user.role,
        plan: user.plan,
      },
    });
  }
);

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user?.id).select('-password');

  if (user) {
    // Get accurate current limits and plan for response
    const limitCheck = await getUploadLimits(user.id);
    const refreshedCounters = await User.findById(user.id)
      .select('uploadsUsedToday uploadsOnHold')
      .lean();
    const uploadsUsedToday = Number(refreshedCounters?.uploadsUsedToday ?? user.uploadsUsedToday ?? 0);
    const uploadsOnHold = Number(refreshedCounters?.uploadsOnHold ?? user.uploadsOnHold ?? 0);

    res.json({
      success: true,
      data: {
        user: {
          _id: user.id,
          email: user.email,
          role: user.role,
          provider: user.provider,
          profileImage: user.profileImage,
          isYoutubeConnected: user.isYoutubeConnected,
          emailNotificationsEnabled: user.emailNotificationsEnabled,
          telegramNotificationsEnabled: user.telegramNotificationsEnabled,
          pushNotificationsEnabled: user.pushNotificationsEnabled,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionExpiresAt: user.subscriptionExpiresAt,
          templateFont: user.templateFont,
          templateColor: user.templateColor,
          lastInputMode: user.lastInputMode,
          lastPrompt: user.lastPrompt,
          lastSelectedTopic: user.lastSelectedTopic,
          lastCustomTopic: user.lastCustomTopic,
          lastChannelInputs: user.lastChannelInputs,
          referralCode: user.referralCode,
          cancelAtPeriodEnd: user.cancelAtPeriodEnd,
          youtubeChannels: user.youtubeChannels,
        },
        plan: limitCheck.plan,
        displayPlan: limitCheck.displayPlan,
        isBetaMode: limitCheck.isBetaMode,
        planFeatures: limitCheck.features || {},
        remainingUploads: limitCheck.remainingUploads,
        uploadsUsedToday,
        uploadsOnHold,
        uploadLimitPerDay: limitCheck.dailyLimit,
        uploadLimit: limitCheck.dailyLimit,
      },
    });
  } else {
    throw new AppError('User not found', 404);
  }
});

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(
  async (req: Request<unknown, unknown, LoginInput>, res: Response) => {
    const { email, password } = req.body;

    // Check for user email
    const user = await User.findOne({ email });

    if (!user || !user.password) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.isEmailVerified) {
      res.status(403).json({
        success: false,
        message: 'Please verify your email',
        unverified: true
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = generateToken(user.id);
    setTokenCookie(res, token);

    res.json({
      success: true,
      message: 'User logged in successfully',
      data: {
        _id: user.id,
        email: user.email,
        role: user.role,
        plan: user.plan,
        token,
      },
    });
  }
);

// @desc    Authenticate an admin user
// @route   POST /api/auth/admin-login
// @access  Public
// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Public
export const logout = asyncHandler(async (req: Request, res: Response) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    expires: new Date(0),
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });

  clearOauthStateCookie(res);

  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

// @desc    Authenticate an admin user
export const adminLogin = asyncHandler(
  async (req: Request<unknown, unknown, AdminLoginInput>, res: Response) => {
    const { username, password } = req.body;

    const user = await User.findOne({ email: username, role: 'admin' });

    if (!user || !user.password) {
      throw new AppError('Invalid credentials', 401);
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = generateToken(user.id);
    setTokenCookie(res, token);

    res.json({
      success: true,
      message: 'Admin logged in successfully',
      data: {
        _id: user.id,
        email: user.email,
        role: user.role,
        plan: user.plan,
        token,
      },
    });
  }
);

// @desc    Verify user email
// @route   GET /api/auth/verify-email
// @access  Public
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token, redirect } = req.query;

  if (!token || typeof token !== 'string') {
    throw new AppError('Invalid token', 400);
  }

  // Hash the incoming token
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with this token and check if it's expired
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Invalid or expired token', 400);
  }

  // Update user
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;

  await user.save();

  const jwtToken = generateToken(user.id);
  setTokenCookie(res, jwtToken);

  const redirectUrl = typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/dashboard';

  res.json({
    success: true,
    message: 'Email verified successfully',
    user: {
      _id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    },
    token: jwtToken,
    redirectUrl,
  });
});

// @desc    Resend verification email
// @route   POST /api/auth/resend-verification
// @access  Public
export const resendVerificationEmail = asyncHandler(
  async (req: Request<unknown, unknown, ResendVerificationInput>, res: Response) => {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user || user.isEmailVerified) {
      // Always return success message to prevent email enumeration
      res.json({
        success: true,
        message: 'If the email exists, a verification link has been sent.',
      });
      return;
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

    // Set expiry 15 minutes
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    user.emailVerificationToken = hashedVerificationToken;
    user.emailVerificationExpires = verificationExpires;

    await user.save();

    // Send email
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
    const emailMessage = `Click to verify your email: \n\n ${verificationUrl}`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <p>Click the button below to verify your email:</p>
        <p>
          <a href="${verificationUrl}" style="display:inline-block;padding:10px 16px;background:#7C5CFF;color:#fff;text-decoration:none;border-radius:6px;">
            Verify Email
          </a>
        </p>
        <p style="font-size:12px;color:#6B7280;">If the button doesn't work, copy and paste this link:</p>
        <p style="font-size:12px;color:#6B7280;">${verificationUrl}</p>
      </div>
    `;

    sendEmail(user.email, 'Verify your email', emailMessage, emailHtml).catch(console.error);

    res.json({
      success: true,
      message: 'If the email exists, a verification link has been sent.',
    });
  }
);

// @desc    Send OTP
// @route   POST /api/auth/send-otp
// @access  Public
export const sendOtp = asyncHandler(
  async (req: Request<unknown, unknown, SendOtpInput>, res: Response) => {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user || user.isEmailVerified) {
      res.json({
        success: true,
        message: 'If the email exists and is unverified, an OTP has been sent.',
      });
      return;
    }

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    user.otpToken = hashedOtp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins expiry

    await user.save();

    // Send email
    const emailMessage = `Your verification code is: ${otp}\n\nThis code will expire in 5 minutes.`;
    sendEmail(user.email, 'Your Verification Code', emailMessage).catch(console.error);

    res.json({
      success: true,
      message: 'If the email exists and is unverified, an OTP has been sent.',
    });
  }
);

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
export const verifyOtp = asyncHandler(
  async (req: Request<unknown, unknown, VerifyOtpInput>, res: Response) => {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      throw new AppError('Invalid OTP or expired', 400);
    }

    // Check if locked
    if (user.otpLockUntil && user.otpLockUntil.getTime() > Date.now()) {
      throw new AppError('Too many attempts. Please try again later.', 429);
    }

    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    if (
      !user.otpToken ||
      user.otpToken !== hashedOtp ||
      !user.otpExpires ||
      user.otpExpires.getTime() < Date.now()
    ) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= 5) {
        user.otpLockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lock
      }
      await user.save();
      throw new AppError('Invalid OTP or expired', 400);
    }

    // Success
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    user.otpToken = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    user.otpLockUntil = undefined;

    await user.save();

    const jwtToken = generateToken(user.id);
    setTokenCookie(res, jwtToken);

    res.json({
      success: true,
      message: 'Email verified successfully',
      user: {
        _id: user.id,
        email: user.email,
        role: user.role,
        plan: user.plan,
      },
      token: jwtToken,
    });
  }
);

// @desc    Request password reset
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = asyncHandler(
  async (req: Request<unknown, unknown, ForgotPasswordInput>, res: Response) => {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      // Return success to avoid email enumeration
      res.json({
        success: true,
        message: 'If the email exists, a password reset link has been sent.',
      });
      return;
    }

    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Expiry 30 minutes
    user.passwordResetToken = hashedResetToken;
    user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);

    await user.save();

    // Send email
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    const message = `Click to reset your password: \n\n ${resetUrl}`;

    sendEmail(user.email, 'Reset your password', message).catch(console.error);

    res.json({
      success: true,
      message: 'If the email exists, a password reset link has been sent.',
    });
  }
);

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
export const resetPassword = asyncHandler(
  async (req: Request<unknown, unknown, ResetPasswordInput>, res: Response) => {
    const { token, newPassword } = req.body;

    const hashedResetToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedResetToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw new AppError('Invalid or expired token', 400);
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully',
    });
  }
);

// @desc    Initiate Google OAuth Login
// @route   GET /api/auth/google
// @access  Public
export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const oauth2Client = getGoogleOAuth2Client(req);
  const stateParam = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  const nonce = crypto.randomBytes(24).toString('hex');
  const encodedState = stateParam ? Buffer.from(stateParam, 'utf8').toString('base64url') : '';
  const oauthState = encodedState ? `${nonce}.${encodedState}` : nonce;

  setOauthStateCookie(res, oauthState);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state: oauthState,
    prompt: 'consent',
  });
  res.redirect(authUrl);
});

// @desc    Google OAuth Callback
// @route   GET /api/auth/google/callback
// @access  Public
export const googleCallback = asyncHandler(async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const callbackState = typeof req.query.state === 'string' ? req.query.state : '';
  const cookieState = typeof req.cookies?.oauth_state === 'string' ? req.cookies.oauth_state : '';
  const FRONTEND_URL = getFrontendBaseUrl();

  if (!code) {
    clearOauthStateCookie(res);
    res.redirect(`${FRONTEND_URL}/login?error=Google_Login_Failed`);
    return;
  }

  if (!callbackState || !cookieState || !isTimingSafeEqual(callbackState, cookieState)) {
    clearOauthStateCookie(res);
    res.redirect(`${FRONTEND_URL}/login?error=Invalid_OAuth_State`);
    return;
  }

  clearOauthStateCookie(res);

  const oauth2Client = getGoogleOAuth2Client(req);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: 'v2',
  });

  const { data } = await oauth2.userinfo.get();

  if (!data.email) {
    res.redirect(`${FRONTEND_URL}/login?error=Email_Not_Found`);
    return;
  }

  let user = await User.findOne({ email: data.email });

  if (user) {
    // If local user tries to log in via google, they either need to have provider='google' or we convert them
    // or just allow login but maybe mark them as verified.
    if (user.provider === 'local') {
      // Just log them in but you could update provider to 'google' or keep local. We'll update to Google
      // or at least mark email as verified. Let's just log them in as requested.
      if (!user.isEmailVerified) {
         user.isEmailVerified = true;
         await user.save();
      }
    } else {
      if (data.picture && user.profileImage !== data.picture) {
        user.profileImage = data.picture;
        await user.save();
      }
    }
  } else {
    // Create Google User
    let stateStr = '';
    const stateChunks = callbackState.split('.', 2);
    if (stateChunks.length === 2) {
      try {
        stateStr = Buffer.from(stateChunks[1] || '', 'base64url').toString('utf8');
      } catch {
        stateStr = '';
      }
    }
    let referredBy: string | undefined = undefined;
    if (stateStr && stateStr.startsWith('ref:')) {
      const refCode = stateStr.split(':')[1];
      if (refCode) {
        const referrer = await User.findOne({ referralCode: refCode });
        if (referrer) referredBy = referrer._id.toString();
      }
    }
    const myReferralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const createPayload: any = {
      email: data.email,
      provider: 'google',
      isEmailVerified: true, // Auto-verified by Google
      referralCode: myReferralCode,
    };
    if (referredBy) createPayload.referredBy = referredBy;
    if (data.id) {
      createPayload.googleId = data.id;
    }
    if (data.picture) {
      createPayload.profileImage = data.picture;
    }
    user = await User.create(createPayload);
  }

  const token = generateToken((user._id as unknown) as string);
  setTokenCookie(res, token, true);

  // Set standard token as well in query param or we can just let frontend rely on cookie + /me endpoint.
  // Actually, instructions state "Do NOT pass token in URL."

  res.redirect(`${FRONTEND_URL}/dashboard`);
});
