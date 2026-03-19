import { Router } from 'express';
import { saveToken, getNotifications } from '../controllers/notificationController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

// Protect all notification routes
router.use(protect);

router.post('/save-token', saveToken);
router.get('/', getNotifications);

export default router;
