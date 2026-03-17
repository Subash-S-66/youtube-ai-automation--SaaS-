import express from 'express';
import { generatePrompt } from '../controllers/promptController';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { generatePromptSchema } from '../utils/validators/promptValidators';
import { promptRateLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Apply protection middleware to all routes
router.use(protect);

router.post(
  '/generate',
  promptRateLimiter,
  validate(generatePromptSchema),
  generatePrompt
);

export default router;
