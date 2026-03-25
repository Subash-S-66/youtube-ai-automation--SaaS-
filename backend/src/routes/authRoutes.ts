import express from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, adminLogin, getMe, verifyEmail, forgotPassword, resetPassword, resendVerificationEmail, googleLogin, googleCallback, sendOtp, verifyOtp } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { registerSchema, loginSchema, adminLoginSchema, forgotPasswordSchema, resetPasswordSchema, resendVerificationSchema, sendOtpSchema, verifyOtpSchema } from '../utils/validators/authValidators';
import { authLimiter, resendVerificationLimiter, sendOtpLimiter } from '../middleware/rateLimiter';

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/admin-login', validate(adminLoginSchema), adminLogin);
router.get('/google', googleLogin);
router.get('/google/callback', googleCallback);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerificationLimiter, validate(resendVerificationSchema), resendVerificationEmail);
router.post('/send-otp', sendOtpLimiter, validate(sendOtpSchema), sendOtp);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtp);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);
router.get('/me', protect, getMe);

export default router;
