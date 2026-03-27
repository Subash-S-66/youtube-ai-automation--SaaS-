import { connection } from '../config/redis';

export const acquireLock = async (key: string, ttlSeconds: number): Promise<boolean> => {
  if (!connection) return true; // If no redis, pretend we got the lock (for local dev without redis)
  const result = await connection.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
};

export const releaseLock = async (key: string): Promise<void> => {
  if (!connection) return;
  await connection.del(key);
};
