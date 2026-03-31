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
// Side-effect import: instantiates the BullMQ Worker so pipeline jobs are consumed automatically
import './workers/pipelineWorker';
import mongoose from 'mongoose';

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
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
  console.log('[AI Config] Provider: native-gemini only');
  console.log(`[AI Config] Gemini API: ${geminiConfigured ? 'configured' : 'NOT configured - generation will fail'}`);
  console.log(`[AI Config] Model: ${geminiModel}`);
  console.log('[AI Config] Pipeline Worker: started (BullMQ consumer active)');
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
