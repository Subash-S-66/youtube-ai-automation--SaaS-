import express from 'express';
import { createCheckout, confirmCheckout, convertPlan, createRenewal } from '../controllers/paymentController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/create-checkout', protect, createCheckout);
router.post('/renew', protect, createRenewal);
router.post('/confirm', protect, confirmCheckout);
router.post('/convert', protect, convertPlan);

// Note: /webhook is now directly mounted in app.ts to bypass express.json()
export default router;
