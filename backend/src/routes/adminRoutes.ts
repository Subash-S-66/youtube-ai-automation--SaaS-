import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import {
  getAdminStats,
  getAllUsers,
  getUserDetails,
  updateUserPlan,
} from '../controllers/adminController';

const router = express.Router();

// Apply auth and admin checks to all routes
router.use(protect);
router.use(adminMiddleware);

router.get('/stats', getAdminStats);
router.get('/users', getAllUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id/plan', updateUserPlan);

export default router;
