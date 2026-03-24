import { Router } from 'express';
import { getPublicPlans } from '../controllers/planController';

const router = Router();

router.get('/', getPublicPlans);

export default router;
