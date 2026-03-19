import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes';
import youtubeRoutes from './routes/youtubeRoutes';
import promptRoutes from './routes/promptRoutes';
import pipelineRoutes from './routes/pipelineRoutes';
import paymentRoutes from './routes/paymentRoutes';
import notificationRoutes from './routes/notificationRoutes';
import adminRoutes from './routes/adminRoutes';
import userRoutes from './routes/userRoutes';
import bannerRoutes from './routes/bannerRoutes';
import { errorHandler, AppError } from './middleware/errorHandler';

const app: Application = express();

// Trust proxy for production hosting (e.g. Render, Railway, Azure)
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet());

// CORS Middleware
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Webhook payload needs to remain raw for Stripe Signature verification.
// We mount the explicit route here BEFORE `express.json()` is applied globally.
import { webhookHandler } from './controllers/paymentController';
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), webhookHandler);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/prompt', promptRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/banner', bannerRoutes);

// Base route
app.get('/', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Welcome to the API' });
});

// Handle undefined routes
app.all('*', (req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

// Global Error Handler
app.use(errorHandler);

export default app;
