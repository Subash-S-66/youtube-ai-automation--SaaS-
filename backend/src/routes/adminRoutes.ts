import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import {
  getAdminStats,
  getAllUsers,
  getUserDetails,
  updateUserPlan,
  createNotification,
  setGlobalBanner,
  deleteUserByAdmin,
  getSystemConfig,
  updateSystemConfig,
} from '../controllers/adminController';

const router = express.Router();

// Apply auth and admin checks to all routes
router.use(protect);
router.use(adminMiddleware);

router.get('/stats', getAdminStats);
router.get('/users', getAllUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id/plan', updateUserPlan);
router.delete('/users/:id', deleteUserByAdmin);
router.post('/notify', createNotification);
router.post('/banner', setGlobalBanner);
router.get('/config', getSystemConfig);
router.post('/config', updateSystemConfig);

export default router;
