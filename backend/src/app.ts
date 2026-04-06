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
import { connection as redisConnection } from './config/redis';
import SystemConfig from './models/SystemConfig';

const app: Application = express();

const parseBooleanEnv = (value: unknown, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
};

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

// CORS Middleware
// Supports single or comma-separated frontend URLs via FRONTEND_URL or FRONTEND_URLS.
const allowedOrigins = getAllowedOrigins();

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
      return;
    }

    // In dev, allow any localhost port to prevent CORS failures when Next switches ports.
    if (!isProduction && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Apply generic API rate limiting (after CORS so error responses include CORS headers)
app.use('/api', globalLimiter);

// Webhook payload needs to remain raw for Razorpay signature verification.
import { webhookHandler } from './controllers/paymentController';

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Cookie parser
app.use(cookieParser());

// CSRF Protection setup
import { doubleCsrfProtection, generateToken, csrfErrorHandler } from './middleware/csrfMiddleware';

// We do NOT apply CSRF to webhook routes
app.use('/api/payment/webhook', express.raw({ type: 'application/json', limit: '2mb' }), webhookHandler);
app.use('/api/webhook', webhookRoutes);

// Endpoint to fetch CSRF token for the frontend
app.get('/api/csrf-token', (req: Request, res: Response) => {
  const csrfToken = generateToken(req, res);
  res.json({ csrfToken });
});

// Pipeline-compatible endpoint (Bearer JULES_API_KEY), intentionally outside CSRF middleware.
// app.use('/api/jules', julesRoutes); // Jules removed

// Apply CSRF to all following routes except Webhooks which we mapped above
app.use(doubleCsrfProtection);
app.use(csrfErrorHandler);

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
app.use('/api/plans', planRoutes);

import path from 'path';

// Disable public access to uploads unless explicitly requested via authenticated endpoint
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Base route
app.get('/', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Welcome to the API' });
});

import mongoose from 'mongoose';
const countPipelineWorkerHeartbeats = async (): Promise<number> => {
  if (!process.env.REDIS_URL) {
    return 0;
  }

  try {
    let cursor = '0';
    let count = 0;

    do {
      const scanResult = await (redisConnection as any).scan(
        cursor,
        'MATCH',
        'pipeline:worker:heartbeat:*',
        'COUNT',
        100
      );
      const nextCursor = Array.isArray(scanResult) ? String(scanResult[0] ?? '0') : '0';
      const keys = Array.isArray(scanResult) && Array.isArray(scanResult[1]) ? scanResult[1] : [];
      count += keys.length;
      cursor = nextCursor;
    } while (cursor !== '0');

    return count;
  } catch {
    return 0;
  }
};

app.get('/health', async (req: Request, res: Response) => {
  let config: any = null;
  try {
    config = await SystemConfig.findOne()
      .sort({ updatedAt: -1 })
      .select('pipelineRunner pipelineRunnerPinned runEmbeddedWorker autoStartEmbeddedWorkerWhenMissing pipelineServiceUrl');
  } catch {
    // Keep health endpoint resilient even if config lookup fails.
  }

  const redisStatus = process.env.REDIS_URL
    ? String((redisConnection as any)?.status || 'unknown')
    : 'disabled';
  const workerHeartbeats = await countPipelineWorkerHeartbeats();
  const pipelineRunner = String(config?.pipelineRunner || process.env.PIPELINE_RUNNER || 'local').toLowerCase();
  const pipelineRunnerPinned = typeof config?.pipelineRunnerPinned === 'boolean'
    ? config.pipelineRunnerPinned
    : parseBooleanEnv(process.env.PIPELINE_RUNNER_PINNED, false);
  const embeddedWorkerConfigured = typeof config?.runEmbeddedWorker === 'boolean'
    ? config.runEmbeddedWorker
    : parseBooleanEnv(process.env.RUN_EMBEDDED_WORKER, false);
  const autoStartEmbeddedWorkerWhenMissing = typeof config?.autoStartEmbeddedWorkerWhenMissing === 'boolean'
    ? config.autoStartEmbeddedWorkerWhenMissing
    : parseBooleanEnv(process.env.AUTO_START_EMBEDDED_WORKER_WHEN_MISSING, false);
  const remoteRunnerConfigured = Boolean(String(config?.pipelineServiceUrl || process.env.PIPELINE_SERVICE_URL || '').trim());
  const missingAzureEnv: string[] = [];
  if (!String(process.env.AZURE_JOB_NAME || '').trim()) {
    missingAzureEnv.push('AZURE_JOB_NAME');
  }
  if (!String(process.env.AZURE_RESOURCE_GROUP || process.env.RESOURCE_GROUP || '').trim()) {
    missingAzureEnv.push('AZURE_RESOURCE_GROUP|RESOURCE_GROUP');
  }
  if (!String(process.env.AZURE_SUBSCRIPTION_ID || '').trim()) {
    missingAzureEnv.push('AZURE_SUBSCRIPTION_ID');
  }
  if (!String(process.env.AZURE_TENANT_ID || '').trim()) {
    missingAzureEnv.push('AZURE_TENANT_ID');
  }
  if (!String(process.env.AZURE_CLIENT_ID || '').trim()) {
    missingAzureEnv.push('AZURE_CLIENT_ID');
  }
  if (!String(process.env.AZURE_CLIENT_SECRET || '').trim()) {
    missingAzureEnv.push('AZURE_CLIENT_SECRET');
  }

  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: redisStatus,
    uptime: process.uptime(),
    pipelineRunner,
    pipelineRunnerPinned,
    embeddedWorkerConfigured,
    autoStartEmbeddedWorkerWhenMissing,
    pipelineWorkerHeartbeats: workerHeartbeats,
    azureRunnerConfigured: missingAzureEnv.length === 0,
    remoteRunnerConfigured,
    missingAzureEnv,
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
