import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
import app from './app';
import connectDB from './config/db';
import { initializeFirebaseAdmin } from './config/firebaseAdmin';
import { ensureAdminUser } from './utils/ensureAdminUser';
import { ensureSystemConfigSingleton } from './utils/ensureSystemConfig';
import { startScheduleRunner } from './workers/scheduleRunner';
import { ensureDefaultPlans } from './config/plans';
import { recoverCrashedJobs, startStuckJobCleanupInterval } from './workers/stuckJobCleanup';
import { connection as redisConnection } from './config/redis';
import mongoose from 'mongoose';

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
};

const runEmbeddedWorker = parseBooleanEnv(process.env.RUN_EMBEDDED_WORKER, false);
const autoStartEmbeddedWorkerWhenMissing = parseBooleanEnv(
  process.env.AUTO_START_EMBEDDED_WORKER_WHEN_MISSING,
  true
);

let embeddedWorkerStarted = false;

const startEmbeddedWorker = (reason: string): void => {
  if (embeddedWorkerStarted) {
    return;
  }
  require('./workers/pipelineWorker');
  embeddedWorkerStarted = true;
  console.log(`[Bootstrap] Embedded pipeline worker started (${reason}).`);
};

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
  } catch (error) {
    console.warn('[Bootstrap] Failed to inspect pipeline worker heartbeat keys:', error);
    return 0;
  }
};

// Initialize Firebase Admin
initializeFirebaseAdmin();

// Connect to Database
connectDB().then(async () => {
  if (mongoose.connection.readyState >= 1) {
    try {
      await ensureAdminUser();
      await ensureSystemConfigSingleton();
      await ensureDefaultPlans();
      await recoverCrashedJobs();
      startStuckJobCleanupInterval();
      await startScheduleRunner();
      if (runEmbeddedWorker) {
        startEmbeddedWorker('RUN_EMBEDDED_WORKER=true');
      } else {
        console.log('[Bootstrap] Embedded pipeline worker is disabled. Run a dedicated worker process (npm run worker).');
        if (autoStartEmbeddedWorkerWhenMissing) {
          const heartbeatCount = await countPipelineWorkerHeartbeats();
          if (heartbeatCount > 0) {
            console.log(`[Bootstrap] Dedicated pipeline worker heartbeat detected (${heartbeatCount} active).`);
          } else {
            console.warn('[Bootstrap] No dedicated pipeline worker heartbeat detected. Auto-starting embedded worker to prevent queued jobs from stalling.');
            startEmbeddedWorker('auto-recovery:no-dedicated-heartbeat');
          }
        }
      }
    } catch (bootErr) {
      console.error('[Bootstrap] Startup task failed:', bootErr);
    }
  } else {
    console.warn('[MongoDB] Skipping admin init and schedule runner (no DB connection).');
  }
}).catch((err) => {
  console.error('Failed to ensure admin user', err);
});

const PORT = process.env.PORT || 5000;
import { initSocket } from './socket';
import { createServer } from 'http';

const server = createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);

  // AI Provider diagnostics
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  console.log('[AI Config] Provider: native-gemini only');
  console.log(`[AI Config] Gemini API: ${geminiConfigured ? 'configured' : 'NOT configured - generation will fail'}`);
  console.log(`[AI Config] Model: ${geminiModel}`);
  console.log(`[AI Config] Embedded Pipeline Worker (configured): ${runEmbeddedWorker ? 'enabled' : 'disabled'}`);
  console.log(`[AI Config] Embedded Pipeline Worker (active): ${embeddedWorkerStarted ? 'yes' : 'no'}`);
  if (!runEmbeddedWorker) {
    console.log(`[AI Config] Embedded worker auto-recovery: ${autoStartEmbeddedWorkerWhenMissing ? 'enabled' : 'disabled'}`);
  }
});

const shouldCrashOnUnhandled =
  process.env.CRASH_ON_UNHANDLED_REJECTION === 'true' ||
  process.env.NODE_ENV !== 'production';

const gracefulShutdown = (reason: string, err?: unknown) => {
  console.error(`[Process] ${reason}`, err);
  if (!shouldCrashOnUnhandled) {
    return;
  }
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('unhandledRejection', (err: unknown) => {
  gracefulShutdown('Unhandled Promise Rejection', err);
});

process.on('uncaughtException', (err: Error) => {
  gracefulShutdown('Uncaught Exception', err);
});
