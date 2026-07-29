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
import { resolveCookieDomain } from '../utils/cookieDomain';

const AUTH_GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

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
  if (!compact) {
    return '';
  }

  let candidate = compact;
  if (!/^https?:\/\//i.test(candidate)) {
    const localLike = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(candidate);
    candidate = `${localLike ? 'http' : 'https'}://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return compact.replace(/\/+$/, '');
  }
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

const resolveGoogleAuthCallbackUrl = (req?: Request): string => {
  const explicitRaw = decodeUrlValue(
    process.env.GOOGLE_REDIRECT_URI || process.env.AUTH_GOOGLE_REDIRECT_URI || ''
  )
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (explicitRaw) {
    try {
      const parsed = new URL(explicitRaw);
      return `${parsed.protocol}//${parsed.host}${AUTH_GOOGLE_CALLBACK_PATH}`;
    } catch {
      // Fall through to dynamic backend URL construction
    }
  }

  const backendUrl = normalizeBaseUrl(resolveBackendBaseUrl(req));
  return `${backendUrl}${AUTH_GOOGLE_CALLBACK_PATH}`;
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

// OAuth redirects are top-level GET navigations, so SameSite=Lax remains compatible
// while avoiding stricter third-party cookie handling in some browsers.
const oauthCookieSameSite: 'lax' = 'lax';
const oauthCookieSecure = process.env.NODE_ENV === 'production';
// OAuth callback redirects to frontend pages that call the API via XHR; use None in production.
const authCookieSameSite: 'none' | 'lax' = process.env.NODE_ENV === 'production' ? 'none' : 'lax';
const authCookieSecure = process.env.NODE_ENV === 'production' || authCookieSameSite === 'none';
const authCookieMaxAge = 7 * 24 * 60 * 60 * 1000;
type RequestWithHeaders = Pick<Request, 'get'>;

const setOauthStateCookie = (req: RequestWithHeaders, res: Response, stateValue: string) => {
  res.cookie('oauth_state', stateValue, {
    httpOnly: true,
    secure: oauthCookieSecure,
    sameSite: oauthCookieSameSite,
    maxAge: 10 * 60 * 1000,
    domain: resolveCookieDomain(req, process.env.COOKIE_DOMAIN),
  });
};

const clearOauthStateCookie = (req: RequestWithHeaders, res: Response) => {
  res.cookie('oauth_state', '', {
    httpOnly: true,
    expires: new Date(0),
    secure: oauthCookieSecure,
    sameSite: oauthCookieSameSite,
    domain: resolveCookieDomain(req, process.env.COOKIE_DOMAIN),
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

type OAuthStatePayload = {
  nonce: string;
  exp: number;
  state?: string;
};

const getOAuthStateSecret = () => {
  const candidate = (
    process.env.OAUTH_STATE_SECRET ||
    process.env.JWT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.YOUTUBE_CLIENT_SECRET ||
    ''
  ).trim();
  if (!candidate) {
    throw new Error('Missing OAuth state secret');
  }
  return candidate;
};

const signOAuthState = (encodedPayload: string) =>
  crypto.createHmac('sha256', getOAuthStateSecret()).update(encodedPayload).digest('base64url');

const createOAuthState = (state: string): string => {
  const payload: OAuthStatePayload = {
    nonce: crypto.randomBytes(24).toString('hex'),
    exp: Date.now() + 10 * 60 * 1000,
    ...(state ? { state } : {}),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signOAuthState(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

const parseOAuthStatePayload = (value: string): OAuthStatePayload | null => {
  const [encodedPayload, signature, ...rest] = value.split('.');
  if (!encodedPayload || !signature || rest.length > 0) {
    return null;
  }

  const expectedSignature = signOAuthState(encodedPayload);
  if (!isTimingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (!decoded || typeof decoded !== 'object') {
      return null;
    }
    if (typeof decoded.nonce !== 'string' || decoded.nonce.length < 24) {
      return null;
    }
    if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp) || decoded.exp <= Date.now()) {
      return null;
    }
    if (decoded.state && typeof decoded.state !== 'string') {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
};

const parseLegacyReferralState = (value: string): string => {
  const stateChunks = value.split('.', 2);
  if (stateChunks.length !== 2) {
    return '';
  }

  try {
    return Buffer.from(stateChunks[1] || '', 'base64url').toString('utf8');
  } catch {
    return '';
  }
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
const setTokenCookie = (req: RequestWithHeaders, res: Response, token: string, isOAuth: boolean = false) => {
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
    maxAge: authCookieMaxAge,
    domain: resolveCookieDomain(req, process.env.COOKIE_DOMAIN),
  });
};

const getGoogleOAuth2Client = (req?: Request) => {
  const callbackUrl = resolveGoogleAuthCallbackUrl(req);
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error('Missing Google OAuth configuration');
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
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
          isYoutubeConnected: Boolean(user.isYoutubeConnected || (user.youtubeChannels && user.youtubeChannels.length > 0)),
          emailNotificationsEnabled: user.emailNotificationsEnabled,
          telegramNotificationsEnabled: user.telegramNotificationsEnabled,
          pushNotificationsEnabled: user.pushNotificationsEnabled,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionExpiresAt: user.subscriptionExpiresAt,
          templateFont: user.templateFont,
          templateColor: user.templateColor,
          lastInputMode: user.lastInputMode,
          lastSelectedChannelId: (user as any).lastSelectedChannelId,
          lastPrompt: user.lastPrompt,
          lastSelectedTopic: user.lastSelectedTopic,
          lastCustomTopic: user.lastCustomTopic,
          lastChannelInputs: user.lastChannelInputs,
          referralCode: user.referralCode,
          cancelAtPeriodEnd: user.cancelAtPeriodEnd,
          youtubeChannels: user.youtubeChannels,
        },
        youtubeChannels: user.youtubeChannels,
        plan: limitCheck.plan,
        displayPlan: limitCheck.displayPlan,
        isBetaMode: limitCheck.isBetaMode,
        planFeatures: limitCheck.features || {},
        planLimits: limitCheck.planLimits || {},
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

    if (user.role === 'helper') {
      throw new AppError('Helper accounts must sign in from staff login', 403);
    }

    const token = generateToken(user.id);
    setTokenCookie(req, res, token);

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

// @desc    Authenticate a staff user
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
    domain: resolveCookieDomain(req, process.env.COOKIE_DOMAIN),
  });

  clearOauthStateCookie(req, res);

  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

// @desc    Authenticate a staff user
export const adminLogin = asyncHandler(
  async (req: Request<unknown, unknown, AdminLoginInput>, res: Response) => {
    const { username, password } = req.body;

    const user = await User.findOne({ email: username, role: { $in: ['admin', 'helper'] } });

    if (!user || !user.password) {
      throw new AppError('Invalid credentials', 401);
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = generateToken(user.id);
    setTokenCookie(req, res, token);

    const roleLabel = user.role === 'helper' ? 'Helper' : 'Admin';

    res.json({
      success: true,
      message: `${roleLabel} logged in successfully`,
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
  setTokenCookie(req, res, jwtToken);

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
    setTokenCookie(req, res, jwtToken);

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
  const FRONTEND_URL = getFrontendBaseUrl();
  try {
    const oauth2Client = getGoogleOAuth2Client(req);
    const stateParam = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const oauthState = createOAuthState(stateParam);
    const forceAccountSelection =
      String(req.query.select_account || '').toLowerCase() === '1' ||
      String(req.query.select_account || '').toLowerCase() === 'true';

    setOauthStateCookie(req, res, oauthState);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'online',
      include_granted_scopes: true,
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state: oauthState,
      ...(forceAccountSelection ? { prompt: 'select_account' } : {}),
    });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.redirect(authUrl);
  } catch {
    clearOauthStateCookie(req, res);
    res.redirect(`${FRONTEND_URL}/login?error=Google_OAuth_Config_Error`);
  }
});

// @desc    Google OAuth Callback
// @route   GET /api/auth/google/callback
// @access  Public
export const googleCallback = asyncHandler(async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const callbackState = typeof req.query.state === 'string' ? req.query.state : '';
  const cookieState = typeof req.cookies?.oauth_state === 'string' ? req.cookies.oauth_state : '';
  const FRONTEND_URL = getFrontendBaseUrl();
  const oauthProviderError = typeof req.query.error === 'string' ? req.query.error : '';

  if (oauthProviderError) {
    clearOauthStateCookie(req, res);
    if (oauthProviderError === 'access_denied') {
      res.redirect(`${FRONTEND_URL}/login?error=Google_Access_Denied`);
      return;
    }
    res.redirect(`${FRONTEND_URL}/login?error=Google_Login_Failed`);
    return;
  }

  if (!code) {
    clearOauthStateCookie(req, res);
    res.redirect(`${FRONTEND_URL}/login?error=Google_Login_Failed`);
    return;
  }

  const hasMatchingCookieState = Boolean(
    callbackState &&
    cookieState &&
    isTimingSafeEqual(callbackState, cookieState)
  );
  const oauthStatePayload = callbackState ? parseOAuthStatePayload(callbackState) : null;

  if (!callbackState || (!hasMatchingCookieState && !oauthStatePayload)) {
    clearOauthStateCookie(req, res);
    res.redirect(`${FRONTEND_URL}/login?error=Invalid_OAuth_State`);
    return;
  }

  clearOauthStateCookie(req, res);
  try {
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
      // Allow local users to continue with Google and verify email status.
      if (user.provider === 'local') {
        if (!user.isEmailVerified) {
          user.isEmailVerified = true;
          await user.save();
        }
      } else if (data.picture && user.profileImage !== data.picture) {
        user.profileImage = data.picture;
        await user.save();
      }
    } else {
      // Create Google User
      const stateStr = oauthStatePayload?.state || parseLegacyReferralState(callbackState);
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

    const token = generateToken(user.id);
    setTokenCookie(req, res, token, true);

    res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.error(`[Auth] Google OAuth callback failed: ${reason}`);
    res.redirect(`${FRONTEND_URL}/login?error=Google_Login_Failed`);
  }
});
