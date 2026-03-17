import { Request, Response, NextFunction } from 'express';

// Extend the Express Request to include a 'user' property globally
export {};

declare global {
  namespace Express {
    export interface Request {
      user?: any;
    }
  }
}
