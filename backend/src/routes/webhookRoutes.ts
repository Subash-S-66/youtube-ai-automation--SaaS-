import { Router } from 'express';
import { handleJobStatusWebhook, handlePipelineCompleteWebhook } from '../controllers/webhookController';

const router = Router();

router.post('/job-status', handleJobStatusWebhook);
router.post('/pipeline-complete', handlePipelineCompleteWebhook);

export default router;
