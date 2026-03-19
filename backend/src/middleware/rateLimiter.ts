import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { connection } from '../config/redis';

// Global rate limiter (100 requests per 15 minutes per IP)
export const globalLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error - ioredis types mismatch in express-rate-limit
    sendCommand: (...args: string[]) => connection.call(...args),
  }),
  windowMs: 15 * 60 * 1000,
  max: 1000, // 1000 requests per 15 mins for generic API routes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
});

// Strict rate limiter for auth routes (e.g., login, register, reset password)
export const authLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error
    sendCommand: (...args: string[]) => connection.call(...args),
  }),
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 20, // start blocking after 20 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after an hour',
  },
});

// Strict rate limiter for expensive pipeline runs (per IP)
export const pipelineLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error
    sendCommand: (...args: string[]) => connection.call(...args),
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 5, // max 5 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many pipeline generation requests, please try again later',
  },
  keyGenerator: (req) => {
      // If user is authenticated, rate limit by user ID rather than IP to prevent abuse across IPs
      if (req.user && req.user.id) {
          return `pipeline_user_${req.user.id}`;
      }
      return `pipeline_ip_${req.ip}`;
  }
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
