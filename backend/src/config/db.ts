import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGO_URI;
    const allowNoDb = process.env.ALLOW_NO_DB === 'true';

    if (!mongoUri) {
      if (allowNoDb) {
        console.warn('[MongoDB] MONGO_URI not set. Continuing without database connection.');
        return;
      }
      throw new Error('MONGO_URI is not defined in the environment variables');
    }

    const conn = await mongoose.connect(mongoUri);
    console.log(`[MongoDB] Connected: ${conn.connection.host}`);
  } catch (error) {
    if (error instanceof Error) {
      if (process.env.ALLOW_NO_DB === 'true') {
        console.warn(`[MongoDB] Connection failed (${error.message}). Continuing without database connection.`);
        return;
      }
      console.error(`[MongoDB] Error: ${error.message}`);
    } else {
      if (process.env.ALLOW_NO_DB === 'true') {
        console.warn('[MongoDB] Unknown connection error. Continuing without database connection.');
        return;
      }
      console.error('[MongoDB] Unknown error while connecting.');
    }
    process.exit(1);
  }
};

export default connectDB;
