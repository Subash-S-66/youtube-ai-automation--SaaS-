import express from 'express';
import { generatePrompt } from '../controllers/promptController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { generatePromptSchema } from '../utils/validators/promptValidators';
import { globalLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Apply protection middleware to all routes
router.use(protect);

router.post(
  '/generate',
  globalLimiter,
  validate(generatePromptSchema),
  generatePrompt
);

export default router;
