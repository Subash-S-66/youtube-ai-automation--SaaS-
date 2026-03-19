import express from 'express';
import { createTicket } from '../controllers/supportController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { createSupportTicketSchema } from '../utils/validators/supportValidators';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 support requests per `window`
  message: {
    success: false,
    message: 'Too many support requests created from this IP, please try again after 15 minutes',
  },
});

router.post('/', protect, supportLimiter, validate(createSupportTicketSchema), createTicket);

export default router;
