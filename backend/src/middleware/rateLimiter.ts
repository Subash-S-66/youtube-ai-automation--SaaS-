import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { connection } from '../config/redis';

export const promptRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per `window` (here, per 1 minute)
  message: {
    status: 429,
    success: false,
    message: 'Too many requests from this IP, please try again after a minute',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

export const pipelineRateLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error - Known typing mismatch with ioredis, works at runtime
    sendCommand: (...args: string[]) => connection.call(...args),
  }),
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 requests per 1 minute to prevent queue flooding
  message: {
    status: 429,
    success: false,
    message: 'Queue flood protection triggered: Maximum 5 jobs per minute allowed. Please wait.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
