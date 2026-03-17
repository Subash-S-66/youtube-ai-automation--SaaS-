import express from 'express';
import { register, login } from '../controllers/authController';
import { validate } from '../middleware/validateResource';
import { registerSchema, loginSchema } from '../utils/validators/authValidators';

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);

export default router;
