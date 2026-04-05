import { Router } from 'express';
import {
  getUserTicket,
  sendMessage,
  closeTicket,
  getAdminTickets,
  getAdminTicketMessages
} from '../controllers/supportController';
import { protect } from '../middleware/authMiddleware';
import { supportStaffMiddleware } from '../middleware/adminMiddleware';

const router = Router();

// User routes
router.get('/ticket', protect, getUserTicket);
router.post('/message', protect, sendMessage);
router.patch('/ticket/:id/close', protect, closeTicket);

// Admin routes
router.get('/admin/tickets', protect, supportStaffMiddleware, getAdminTickets);
router.get('/admin/tickets/:id/messages', protect, supportStaffMiddleware, getAdminTicketMessages);

export default router;
