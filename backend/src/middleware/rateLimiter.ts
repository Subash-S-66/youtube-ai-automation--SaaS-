import rateLimit, { ipKeyGenerator, type Options, type Store } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { connection } from '../config/redis';

const isRedisReady = (): boolean => {
  if (!connection) {
    return false;
  }
  const status = String((connection as any).status || '').toLowerCase();
  return status === 'ready';
};

let warnedRedisStoreFallback = false;

const warnRedisStoreFallback = (reason: string): void => {
  if (warnedRedisStoreFallback) {
    return;
  }
  warnedRedisStoreFallback = true;
  console.warn(`[RateLimiter] Using in-memory limiter store (${reason}).`);
};

const createRedisStore = (prefix: string): Store | undefined => {
  if (!connection) {
    warnRedisStoreFallback('redis connection unavailable');
    return undefined;
  }

  if (!isRedisReady()) {
    const status = String((connection as any).status || 'unknown');
    warnRedisStoreFallback(`redis not ready (status=${status})`);
    return undefined;
  }

  try {
    const store: any = new RedisStore({
      sendCommand: async (...args: string[]) => {
        if (!connection) {
          throw new Error('Redis connection is not initialized');
        }
        const status = String((connection as any).status || '').toLowerCase();
        if (status !== 'ready') {
          throw new Error(`Redis unavailable for rate limiting (status=${status || 'unknown'})`);
        }
        return (connection as any).call(...args);
      },
      prefix,
    });

    // Avoid unhandled Promise rejections when SCRIPT LOAD happens before Redis is fully writable.
    if (store?.incrementScriptSha && typeof store.incrementScriptSha.catch === 'function') {
      store.incrementScriptSha.catch((error: any) => {
        console.warn(`[RateLimiter] Increment script preload failed for ${prefix}: ${error?.message || error}`);
      });
    }
    if (store?.getScriptSha && typeof store.getScriptSha.catch === 'function') {
      store.getScriptSha.catch((error: any) => {
        console.warn(`[RateLimiter] Get script preload failed for ${prefix}: ${error?.message || error}`);
      });
    }

    return store as Store;
  } catch (error: any) {
    warnRedisStoreFallback(error?.message || 'redis store init failure');
    return undefined;
  }
};

const withStore = (options: Partial<Options>, prefix: string) => {
  if (!connection) {
    return rateLimit(options);
  }

  const store = createRedisStore(prefix);
  return rateLimit({
    passOnStoreError: true,
    ...options,
    ...(store ? { store } : {}),
  });
};

// Global rate limiter (100 requests per 15 minutes per IP)
export const globalLimiter = withStore({
  windowMs: 15 * 60 * 1000,
  limit: 1000, // 1000 requests per 15 mins for generic API routes
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
}, 'rl_global:');

// Strict rate limiter for auth routes (e.g., login, register, reset password)
export const authLimiter = withStore({
  windowMs: 60 * 60 * 1000, // 1 hour window
  limit: 20, // start blocking after 20 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after an hour',
  },
}, 'rl_auth:');

// Limit login attempts per IP
export const loginLimiter = withStore({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // Max 20 attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again after 15 minutes.',
  },
}, 'rl_login:');

// Strict rate limiter for expensive pipeline runs (per IP)
export const pipelineLimiter = withStore({
  windowMs: 60 * 1000, // 1 minute
  limit: 5, // max 5 requests per minute
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
      const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
      return `pipeline_ip_${ipKeyGenerator(ip)}`;
  }
}, 'rl_pipeline:');

export const pipelineRateLimiter = withStore({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 5, // Limit each IP to 5 requests per 1 minute to prevent queue flooding
  message: {
    status: 429,
    success: false,
    message: 'Queue flood protection triggered: Maximum 5 jobs per minute allowed. Please wait.',
  },
  standardHeaders: true,
  legacyHeaders: false,
}, 'rl_pipeline_queue:');

export const mediaUploadLimiter = withStore({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 30,
  message: { success: false, message: 'Too many uploads. Try again in 1 hour.' },
}, 'rl_media_upload:');

export const resendVerificationLimiter = withStore({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 1, // Max 1 request per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again after 1 minute.',
  },
}, 'rl_resend_verification:');

export const paymentRateLimiter = withStore({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 30,
  message: { success: false, message: 'Too many payment attempts. Please try again shortly.' },
}, 'rl_payment:');

export const sendOtpLimiter = withStore({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 1, // Max 1 request per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again after 1 minute.',
  },
}, 'rl_send_otp:');

export const sendOtpHourlyLimiter = withStore({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5, // Max 5 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many OTP requests, please try again after 1 hour.',
  },
}, 'rl_send_otp_hourly:');

// Limit account creation attempts per IP
export const registerLimiter = withStore({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3, // Max 3 account creations per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many account creation attempts. Please try again later.',
  },
}, 'rl_register:');
