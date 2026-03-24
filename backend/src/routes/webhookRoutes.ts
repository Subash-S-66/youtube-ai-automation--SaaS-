import { Router } from 'express';
import { handleJobStatusWebhook } from '../controllers/webhookController';

const router = Router();

router.post('/job-status', handleJobStatusWebhook);

export default router;
