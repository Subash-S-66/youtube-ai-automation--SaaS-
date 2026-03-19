import express from 'express';
import { startPipeline, getJobs } from '../controllers/pipelineController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { runPipelineSchema } from '../utils/validators/pipelineValidators';
import { pipelineLimiter } from '../middleware/rateLimiter';

const router = express.Router();

router.use(protect);

router.get('/jobs', getJobs);

router.post(
  '/run',
  pipelineLimiter,
  validate(runPipelineSchema),
  startPipeline
);

export default router;
