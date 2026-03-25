import express from 'express';
import { connectYouTube, youtubeCallback, disconnectYouTube, getYouTubeAuthUrl } from '../controllers/youtubeController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

// Apply protection middleware to all routes
router.use(protect);

router.get('/auth', connectYouTube);
router.get('/auth-url', getYouTubeAuthUrl);
router.get('/callback', youtubeCallback);
router.post('/disconnect', disconnectYouTube);
router.post('/disconnect/:channelId', disconnectYouTube);

export default router;
