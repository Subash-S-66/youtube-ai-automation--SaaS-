import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { updateSettings, deleteAccount } from '../controllers/userController';

const router = express.Router();

// Apply auth to all routes
router.use(protect);

router.put('/settings', updateSettings);
router.delete('/me', deleteAccount);

export default router;
