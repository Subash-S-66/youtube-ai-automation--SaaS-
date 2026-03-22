import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { uploadMedia, getMedia, deleteMedia } from '../controllers/mediaController';
import multer from 'multer';

const router = express.Router();

// Configure multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Store locally in backend/uploads
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max limit
  fileFilter: (req, file, cb) => {
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
router.delete('/:id', deleteMedia);

export default router;