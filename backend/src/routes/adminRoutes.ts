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
  getAllBanners,
  createBanner,
  updateBanner,
  toggleBannerStatus,
  deleteBanner,
  getGeminiModels,
  deleteUserByAdmin,
  getSystemConfig,
  getPipelineRuntimeStatus,
  getActivePipelineJobs,
  retryPendingPipelineJobs,
  stopPipelineJobByAdmin,
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
router.get('/banners', getAllBanners);
router.post('/banners', createBanner);
router.put('/banners/:id', updateBanner);
router.patch('/banners/:id/toggle', toggleBannerStatus);
router.delete('/banners/:id', deleteBanner);
router.get('/gemini-models', getGeminiModels);
router.get('/config', getSystemConfig);
router.get('/runtime-status', getPipelineRuntimeStatus);
router.get('/pipeline/active-jobs', getActivePipelineJobs);
router.post('/pipeline/retry-pending', retryPendingPipelineJobs);
router.post('/pipeline/jobs/:jobId/stop', stopPipelineJobByAdmin);
router.post('/config', updateSystemConfig);
router.put('/config/timeout', updateTimeoutConfig);
router.post('/trigger-reports', triggerWeeklyReports);
router.get('/plans', getPlans);
router.put('/plans/:id', updatePlan);

export default router;
