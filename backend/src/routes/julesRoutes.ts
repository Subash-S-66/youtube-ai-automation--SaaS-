import { Router } from 'express';
import { generateViaJulesCompat } from '../controllers/julesController';

const router = Router();

router.post('/generate', generateViaJulesCompat);

export default router;

