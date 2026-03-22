import express from 'express';
import { createTicket, getTickets, replyTicket, closeTicket } from '../controllers/supportController';
import { protect } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { validate } from '../middleware/validateResource';
import { createSupportTicketSchema, replySupportTicketSchema } from '../utils/validators/supportValidators';
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

// Admin routes
router.get('/admin', protect, adminMiddleware, getTickets);
router.post('/admin/:id/reply', protect, adminMiddleware, validate(replySupportTicketSchema), replyTicket);
router.post('/admin/:id/close', protect, adminMiddleware, closeTicket);

export default router;
