import Redis from 'ioredis';

export const redisEnabled = !!process.env.REDIS_URL;

// Configure Redis connection only when REDIS_URL is provided
export const connection: Redis | null = redisEnabled
  ? new Redis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
    })
  : null;

if (connection) {
  connection.on('error', (err) => {
    console.error('Redis error:', err);
  });
} else {
  console.warn('[Redis] REDIS_URL not set. Running without Redis-backed queues/rate limits.');
}

export default connection;
