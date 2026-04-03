import express from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, logout, adminLogin, getMe, verifyEmail, forgotPassword, resetPassword, resendVerificationEmail, googleLogin, googleCallback, sendOtp, verifyOtp } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { registerSchema, loginSchema, adminLoginSchema, forgotPasswordSchema, resetPasswordSchema, resendVerificationSchema, sendOtpSchema, verifyOtpSchema } from '../utils/validators/authValidators';
import { authLimiter, resendVerificationLimiter, sendOtpLimiter, sendOtpHourlyLimiter, registerLimiter, loginLimiter } from '../middleware/rateLimiter';

const router = express.Router();

router.post('/register', registerLimiter, validate(registerSchema), register);
router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/logout', logout);
router.post('/admin-login', validate(adminLoginSchema), adminLogin);
router.get('/google', googleLogin);
router.get('/google/callback', googleCallback);
// Guard against malformed frontend URL joins that append extra path segments after /google.
router.get(/^\/google\/.+$/, (_req, res) => {
	res.redirect('/api/auth/google');
});
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerificationLimiter, validate(resendVerificationSchema), resendVerificationEmail);
router.post('/send-otp', sendOtpLimiter, sendOtpHourlyLimiter, validate(sendOtpSchema), sendOtp);
router.post('/verify-otp', sendOtpLimiter, sendOtpHourlyLimiter, validate(verifyOtpSchema), verifyOtp);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);
router.get('/me', protect, getMe);

export default router;
