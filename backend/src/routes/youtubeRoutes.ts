import express from 'express';
import { connectYouTube, youtubeCallback, disconnectYouTube } from '../controllers/youtubeController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

// Apply protection middleware to all routes
router.use(protect);

router.get('/auth', connectYouTube);
router.get('/callback', youtubeCallback);
router.post('/disconnect/:channelId?', disconnectYouTube);

export default router;
