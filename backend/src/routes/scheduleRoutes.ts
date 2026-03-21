import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validateResource';
import { createScheduleSchema } from '../utils/validators/scheduleValidators';
import { createSchedule, getSchedules, deleteSchedule } from '../controllers/scheduleController';

const router = express.Router();

router.use(protect);

router.get('/', getSchedules);
router.post('/', validate(createScheduleSchema), createSchedule);
router.delete('/:id', deleteSchedule);

export default router;
