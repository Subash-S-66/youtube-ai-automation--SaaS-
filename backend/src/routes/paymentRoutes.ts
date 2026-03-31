import express from 'express';
import { createCheckout, confirmCheckout, convertPlan, createRenewal } from '../controllers/paymentController';
import { protect } from '../middleware/authMiddleware';
import { paymentRateLimiter } from '../middleware/rateLimiter';

const router = express.Router();

router.post('/create-checkout', protect, paymentRateLimiter, createCheckout);
router.post('/renew', protect, paymentRateLimiter, createRenewal);
router.post('/confirm', protect, paymentRateLimiter, confirmCheckout);
router.post('/convert', protect, paymentRateLimiter, convertPlan);

// Note: /webhook is now directly mounted in app.ts to bypass express.json()
export default router;
