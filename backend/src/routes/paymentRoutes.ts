import express from 'express';
import { createCheckout, webhookHandler } from '../controllers/paymentController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/create-checkout', protect, createCheckout);

// The webhook needs to parse raw body, so we export it without standard protect middleware
// and we'll handle the raw body parsing in app.ts specifically for this route.
router.post('/webhook', webhookHandler);

export default router;
