import express from 'express';
import { startPipeline, getJobs } from '../controllers/pipelineController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { runPipelineSchema } from '../utils/validators/pipelineValidators';
import { pipelineRateLimiter } from '../middleware/rateLimiter';

const router = express.Router();

router.use(protect);

router.get('/jobs', getJobs);

router.post(
  '/run',
  pipelineRateLimiter,
  validate(runPipelineSchema),
  startPipeline
);

// Alias endpoint to bypass provider-level routing issues on specific path names.
router.post(
  '/start',
  pipelineRateLimiter,
  validate(runPipelineSchema),
  startPipeline
);

export default router;
