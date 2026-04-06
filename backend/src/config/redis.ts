import Redis from 'ioredis';

const redisUrl = String(process.env.REDIS_URL || '').trim();
const parseMs = (raw: unknown, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const REDIS_CONNECT_TIMEOUT_MS = parseMs(process.env.REDIS_CONNECT_TIMEOUT_MS, 8000);
const REDIS_COMMAND_TIMEOUT_MS = parseMs(process.env.REDIS_COMMAND_TIMEOUT_MS, 15000);
const REDIS_MAX_RETRY_DELAY_MS = parseMs(process.env.REDIS_MAX_RETRY_DELAY_MS, 2000);
const REDIS_COMMAND_TIMEOUT_LOG_THROTTLE_MS = parseMs(
  process.env.REDIS_COMMAND_TIMEOUT_LOG_THROTTLE_MS,
  30000
);
let lastRedisCommandTimeoutLogAt = 0;

export const redisEnabled = redisUrl.length > 0;

// Configure Redis connection only when REDIS_URL is provided
export const connection: Redis | null = redisEnabled
  ? new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, REDIS_MAX_RETRY_DELAY_MS),
    })
  : null;

if (connection) {
  connection.on('connect', () => {
    console.log('[Redis] Connected');
  });
  connection.on('ready', () => {
    console.log('[Redis] Ready');
  });
  connection.on('reconnecting', () => {
    console.warn('[Redis] Reconnecting...');
  });
  connection.on('close', () => {
    console.warn('[Redis] Connection closed');
  });
  connection.on('error', (err) => {
    const message = String((err as any)?.message || '').toLowerCase();
    if (message.includes('command timed out')) {
      const now = Date.now();
      if (now - lastRedisCommandTimeoutLogAt >= REDIS_COMMAND_TIMEOUT_LOG_THROTTLE_MS) {
        lastRedisCommandTimeoutLogAt = now;
        console.warn(
          `[Redis] Command timed out after ${REDIS_COMMAND_TIMEOUT_MS}ms. ` +
          'Consider increasing REDIS_COMMAND_TIMEOUT_MS if transient network latency is expected.'
        );
      }
      return;
    }
    console.error('Redis error:', err);
  });
} else {
  console.warn('[Redis] REDIS_URL not set. Running without Redis-backed queues/rate limits.');
}

export default connection;
