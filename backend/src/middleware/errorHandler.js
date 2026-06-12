// Central error handling (Section 11): 400 validation, 401, 409, 429, 500.
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details } });
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error('[error]', err);
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  // Unexpected: log the full error, return a generic message.
  logger.error(`[error] unhandled rid=${req.id || '-'}:`, err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
