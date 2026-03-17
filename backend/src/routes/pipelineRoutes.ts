import express from 'express';
import { startPipeline } from '../controllers/pipelineController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { runPipelineSchema } from '../utils/validators/pipelineValidators';

const router = express.Router();

router.use(protect);

router.post(
  '/run',
  validate(runPipelineSchema),
  startPipeline
);

export default router;
