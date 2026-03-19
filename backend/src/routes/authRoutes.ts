import express from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, adminLogin, getMe, verifyEmail, forgotPassword, resetPassword, resendVerificationEmail, googleLogin, googleCallback } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { registerSchema, loginSchema, adminLoginSchema, forgotPasswordSchema, resetPasswordSchema, resendVerificationSchema } from '../utils/validators/authValidators';
import { authLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Rate limiter for resend verification endpoint (3 requests per 15 minutes)
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/admin-login', validate(adminLoginSchema), adminLogin);
router.get('/google', googleLogin);
router.get('/google/callback', googleCallback);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerificationLimiter, validate(resendVerificationSchema), resendVerificationEmail);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);
router.get('/me', protect, getMe);

export default router;
