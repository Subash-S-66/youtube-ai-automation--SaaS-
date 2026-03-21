import 'dotenv/config';
import app from './app';
import connectDB from './config/db';
import { initializeFirebaseAdmin } from './config/firebaseAdmin';
import { ensureAdminUser } from './utils/ensureAdminUser';
import { ensureSystemConfigSingleton } from './utils/ensureSystemConfig';
import { startScheduleRunner } from './workers/scheduleRunner';
import { ensureDefaultPlans } from './config/plans';

// Initialize Firebase Admin
initializeFirebaseAdmin();

// Connect to Database
connectDB().then(async () => {
  await ensureAdminUser();
  await ensureSystemConfigSingleton();
  startScheduleRunner();
  await ensureDefaultPlans();
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
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
