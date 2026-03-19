import express from 'express';
import { getActiveBanner } from '../controllers/bannerController';

const router = express.Router();

router.get('/', getActiveBanner);

export default router;
