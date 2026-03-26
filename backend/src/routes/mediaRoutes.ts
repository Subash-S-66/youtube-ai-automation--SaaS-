import express, { Request } from 'express';
import { protect } from '../middleware/authMiddleware';
import { uploadMedia, getMedia, getSecureMediaFile, deleteMedia, updateMedia, reorderMedia, reorderMixedMedia, getSequence, addToSequence, reorderSequence, deleteSequenceItem } from '../controllers/mediaController';
import multer, { FileFilterCallback } from 'multer';

const router = express.Router();

// Configure multer
import fs from 'fs';
import path from 'path';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) {
    cb(null, 'uploads/'); // Store locally in backend/uploads
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

// Protect all routes
router.use(protect);

router.post('/upload', upload.single('file'), uploadMedia);
router.get('/', getMedia);
router.get('/file/:filename', getSecureMediaFile);
router.get('/sequence', getSequence);
router.post('/sequence', addToSequence);
router.post('/sequence/reorder', reorderSequence);
router.delete('/sequence/:id', deleteSequenceItem);
router.post('/reorder', reorderMedia);
router.post('/reorder-mixed', reorderMixedMedia);
router.patch('/:id', updateMedia);
router.delete('/:id', deleteMedia);

export default router;
