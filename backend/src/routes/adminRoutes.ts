import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import {
  getAdminStats,
  getAllUsers,
  createAdminUser,
  getUserDetails,
  updateUserPlan,
  createNotification,
  setGlobalBanner,
  getGlobalBannerConfig,
  deleteUserByAdmin,
  getSystemConfig,
  updateSystemConfig,
  updateTimeoutConfig,
  triggerWeeklyReports,
  getPlans,
  updatePlan,
} from '../controllers/adminController';

const router = express.Router();

// Apply auth and admin checks to all routes
router.use(protect);
router.use(adminMiddleware);

router.get('/stats', getAdminStats);
router.get('/users', getAllUsers);
router.post('/users/create-admin', createAdminUser);
router.get('/users/:id', getUserDetails);
router.put('/users/:id/plan', updateUserPlan);
router.delete('/users/:id', deleteUserByAdmin);
router.post('/notify', createNotification);
router.post('/banner', setGlobalBanner);
router.get('/banner', getGlobalBannerConfig);
router.get('/config', getSystemConfig);
router.post('/config', updateSystemConfig);
router.put('/config/timeout', updateTimeoutConfig);
router.post('/trigger-reports', triggerWeeklyReports);
router.get('/plans', getPlans);
router.put('/plans/:id', updatePlan);

export default router;
