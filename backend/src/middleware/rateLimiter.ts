import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
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

// Strict rate limiter for expensive pipeline runs
export const pipelineLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error
    sendCommand: (...args: string[]) => connection.call(...args),
  }),
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 30, // max 30 pipeline run attempts per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many pipeline generation requests, please try again later',
  },
});
