import crypto from 'crypto';
import { doubleCsrf } from 'csrf-csrf';
import { Request, Response, NextFunction } from 'express';

import { CsrfRequestMethod } from 'csrf-csrf';

import { HttpError } from 'http-errors';

const csrfCookieSameSite: 'none' | 'lax' =
  process.env.NODE_ENV === 'production' ? 'none' : 'lax';
const csrfCookieSecure = process.env.NODE_ENV === 'production';
const csrfSessionCookieName = '__session_id';
const devCsrfSecret = crypto.randomBytes(32).toString('hex');

const getCsrfSecret = (): string => {
  const configuredSecret = (process.env.CSRF_SECRET || '').trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  const jwtSecret = (process.env.JWT_SECRET || '').trim();
  if (jwtSecret) {
    return jwtSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CSRF_SECRET is required in production');
  }

  return devCsrfSecret;
};

const ensureCsrfSessionIdentifier = (req: Request, res: Response): string => {
  const existingSessionId = typeof req.cookies?.[csrfSessionCookieName] === 'string'
    ? req.cookies[csrfSessionCookieName].trim()
    : '';

  if (existingSessionId.length >= 16) {
    return existingSessionId;
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  if (!req.cookies) {
    (req as any).cookies = {};
  }
  req.cookies[csrfSessionCookieName] = sessionId;

  res.cookie(csrfSessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: csrfCookieSameSite,
    secure: csrfCookieSecure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  return sessionId;
};

const doubleCsrfOptions = {
  getSecret: getCsrfSecret,
  cookieName: 'x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: csrfCookieSameSite,
    path: '/',
    secure: csrfCookieSecure,
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'] as CsrfRequestMethod[],
  getTokenFromRequest: (req: Request) => {
    const token = req.headers['x-csrf-token'];
    return Array.isArray(token) ? token[0] : (token || '');
  },
  // Ensure we define how the session identifier is retrieved
  // Use a dedicated stable session cookie so JWT rotations do not invalidate CSRF tokens.
  getSessionIdentifier: (req: Request) => {
     const sessionId = typeof req.cookies?.[csrfSessionCookieName] === 'string'
       ? req.cookies[csrfSessionCookieName].trim()
       : '';
     return sessionId || 'anonymous';
  }
};

const doubleCsrfUtility = doubleCsrf(doubleCsrfOptions);

export const invalidCsrfTokenError: HttpError = doubleCsrfUtility.invalidCsrfTokenError;
export const generateToken = (req: Request, res: Response) => {
  ensureCsrfSessionIdentifier(req, res);
  return doubleCsrfUtility.generateCsrfToken(req, res);
};

export const doubleCsrfProtection = (req: Request, res: Response, next: NextFunction) => {
  ensureCsrfSessionIdentifier(req, res);
  return doubleCsrfUtility.doubleCsrfProtection(req, res, next);
};

export const csrfErrorHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
  if (error == invalidCsrfTokenError) {
    res.status(403).json({
      success: false,
      message: 'Invalid CSRF token',
    });
  } else {
    next(error);
  }
};
