import express, { Request } from 'express';
import { protect } from '../middleware/authMiddleware';
import { uploadMedia, getMedia, getSecureMediaFile, deleteMedia, updateMedia, reorderMedia, reorderMixedMedia, getSequence, addToSequence, reorderSequence, deleteSequenceItem } from '../controllers/mediaController';
import multer, { FileFilterCallback } from 'multer';
import { mediaUploadLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Configure multer
import fs from 'fs';
import path from 'path';

import os from 'os';

// Ensure uploads directory exists safely (using /tmp on Vercel Serverless environment)
const uploadDir = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  ? path.join(os.tmpdir(), 'uploads')
  : path.join(__dirname, '../../uploads');

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn('[Storage] Upload directory creation notice:', err);
}

const storage = multer.diskStorage({
  destination: function (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) {
    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    } catch (_) {}
    cb(null, uploadDir);
  },
  filename: function (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // Sanitize filename properly using path.extname to avoid path traversal and malicious extensions
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `file-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max limit
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only videos and images are allowed!'));
    }
  }
});

router.get('/file/:filename', getSecureMediaFile);
// Protect all routes except secure media file fetch (auth handled in controller)
router.use(protect);

router.post('/upload', mediaUploadLimiter, upload.single('file'), uploadMedia); // FIXED: Apply dedicated upload rate limiting before file processing.
router.get('/', getMedia);
router.get('/sequence', getSequence);
router.post('/sequence', addToSequence);
router.post('/sequence/reorder', reorderSequence);
router.delete('/sequence/:id', deleteSequenceItem);
router.post('/reorder', reorderMedia);
router.post('/reorder-mixed', reorderMixedMedia);
router.patch('/:id', updateMedia);
router.delete('/:id', deleteMedia);

export default router;
