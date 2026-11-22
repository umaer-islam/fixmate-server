import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const isProduction = env.NODE_ENV === 'production';
  const statusCode = err.statusCode || 500;
  const message = isProduction && statusCode === 500
    ? 'Internal Server Error'
    : err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: isProduction && statusCode === 500 ? 'InternalServerError' : (err.name || 'Error'),
    message,
    statusCode,
    ...(!isProduction && err.details ? { details: err.details } : {}),
  });
};
