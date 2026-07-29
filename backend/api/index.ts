import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import mongoose from 'mongoose';
import app from '../src/app';

const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState >= 1) {
    return;
  }
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn('[MongoDB] MONGO_URI is missing from environment variables');
    return;
  }
  try {
    await mongoose.connect(mongoUri);
    console.log('[MongoDB] Connected serverless instance');
  } catch (err: any) {
    console.error('[MongoDB] Serverless connection error:', err?.message || err);
  }
};

export default async function handler(req: any, res: any) {
  await connectDB();
  return app(req, res);
}
