import { doubleCsrf } from 'csrf-csrf';
import { Request, Response, NextFunction } from 'express';

import { CsrfRequestMethod } from 'csrf-csrf';

import { HttpError } from 'http-errors';

const csrfCookieSameSite: 'none' | 'lax' =
  process.env.NODE_ENV === 'production' ? 'none' : 'lax';

const doubleCsrfOptions = {
  getSecret: () => process.env.CSRF_SECRET || 'a-very-secure-fallback-secret-for-csrf',
  cookieName: 'x-csrf-token',
  cookieOptions: {
    sameSite: csrfCookieSameSite,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'] as CsrfRequestMethod[],
  getTokenFromRequest: (req: Request) => {
    const token = req.headers['x-csrf-token'];
    return Array.isArray(token) ? token[0] : (token || '');
  },
  // Ensure we define how the session identifier is retrieved
  // For JWT HttpOnly cookies, we can use the `jwt` cookie itself as the session identifier
  getSessionIdentifier: (req: Request) => {
     return req.cookies?.jwt || 'anonymous';
  }
};

const doubleCsrfUtility = doubleCsrf(doubleCsrfOptions);

export const invalidCsrfTokenError: HttpError = doubleCsrfUtility.invalidCsrfTokenError;
export const generateToken = doubleCsrfUtility.generateCsrfToken;
export const doubleCsrfProtection = doubleCsrfUtility.doubleCsrfProtection;

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
