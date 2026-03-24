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
import supportRoutes from './routes/supportRoutes';
import adminRoutes from './routes/adminRoutes';
import userRoutes from './routes/userRoutes';
import bannerRoutes from './routes/bannerRoutes';
import scheduleRoutes from './routes/scheduleRoutes';
import mediaRoutes from './routes/mediaRoutes';
import webhookRoutes from './routes/webhookRoutes';
import planRoutes from './routes/planRoutes';
import { errorHandler, AppError } from './middleware/errorHandler';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { getAllowedOrigins } from './utils/cors';

const app: Application = express();

// Initialize Sentry if DSN is provided
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}

// Trust proxy for production hosting (e.g. Render, Railway, Azure)
app.set('trust proxy', 1);

import { globalLimiter } from './middleware/rateLimiter';

// Security Middleware
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.razorpay.com"],
      frameSrc: ["'self'", "https://checkout.razorpay.com"],
      objectSrc: ["'self'", "https://checkout.razorpay.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Allow frontend (different origin in dev) to load /uploads assets.
  crossOriginResourcePolicy: isProduction ? { policy: 'same-site' } : false,
}));

// Apply generic API rate limiting
app.use('/api', globalLimiter);

// CORS Middleware
// Supports single or comma-separated frontend URLs via FRONTEND_URL or FRONTEND_URLS.
const allowedOrigins = getAllowedOrigins();

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

// Webhook payload needs to remain raw for Razorpay signature verification.
// We mount the explicit route here BEFORE `express.json()` is applied globally.
import { webhookHandler } from './controllers/paymentController';
app.post('/api/payment/webhook', express.raw({ type: 'application/json', limit: '2mb' }), webhookHandler);

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
app.use('/api/support', supportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/banner', bannerRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/plans', planRoutes);

import path from 'path';

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Base route
app.get('/', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Welcome to the API' });
});

import mongoose from 'mongoose';
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: process.env.REDIS_URL ? 'enabled' : 'disabled',
    uptime: process.uptime()
  });
});

// Handle undefined routes
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Global Error Handler
app.use(errorHandler);

export default app;
