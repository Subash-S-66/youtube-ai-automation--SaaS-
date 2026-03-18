import { Request, Response } from 'express';
import User from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RegisterInput, LoginInput, ForgotPasswordInput, ResetPasswordInput, ResendVerificationInput } from '../utils/validators/authValidators';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { sendEmail } from '../services/emailService';
import { canUserUpload } from '../services/uploadLimitService';

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
const setTokenCookie = (res: Response, token: string) => {
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
export const register = asyncHandler(
  async (req: Request<unknown, unknown, RegisterInput>, res: Response) => {
    const { email, password } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });

    if (userExists) {
      throw new AppError('User already exists', 400);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

    // Set expiry 1 hour
    const verificationExpires = new Date(Date.now() + 60 * 60 * 1000);

    // Create user
    const user = await User.create({
      email,
      password: hashedPassword,
      emailVerificationToken: hashedVerificationToken,
      emailVerificationExpires: verificationExpires,
    });

    if (!user) {
      throw new AppError('Invalid user data', 400);
    }

    // Send email
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
    const emailMessage = `Click to verify your email: \n\n ${verificationUrl}`;

    // We send email without blocking the response
    sendEmail(user.email, 'Verify your email', emailMessage).catch(console.error);

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
    const limitCheck = await canUserUpload(user.id);

    res.json({
      success: true,
      data: {
        user: {
          _id: user.id,
          email: user.email,
          role: user.role,
          isYoutubeConnected: user.isYoutubeConnected,
        },
        plan: limitCheck.plan,
        remainingUploads: limitCheck.remainingUploads,
        uploadsOnHold: limitCheck.uploadsOnHold,
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

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.isEmailVerified) {
      throw new AppError('Please verify your email', 403);
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
    token: jwtToken,
    user: {
      _id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    },
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

    // Set expiry 1 hour
    const verificationExpires = new Date(Date.now() + 60 * 60 * 1000);

    user.emailVerificationToken = hashedVerificationToken;
    user.emailVerificationExpires = verificationExpires;

    await user.save();

    // Send email
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
    const emailMessage = `Click to verify your email: \n\n ${verificationUrl}`;

    sendEmail(user.email, 'Verify your email', emailMessage).catch(console.error);

    res.json({
      success: true,
      message: 'If the email exists, a verification link has been sent.',
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
