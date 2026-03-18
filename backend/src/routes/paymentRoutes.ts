import express from 'express';
import { createCheckout } from '../controllers/paymentController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/create-checkout', protect, createCheckout);

// Note: /webhook is now directly mounted in app.ts to bypass express.json()
export default router;
