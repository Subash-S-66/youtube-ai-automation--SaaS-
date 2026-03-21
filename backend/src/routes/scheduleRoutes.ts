import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { createSchedule, getSchedules, deleteSchedule } from '../controllers/scheduleController';

const router = express.Router();

router.use(protect);

router.post('/', createSchedule);
router.get('/', getSchedules);
router.delete('/:id', deleteSchedule);

export default router;
