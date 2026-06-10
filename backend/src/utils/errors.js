// Typed application errors. The errorHandler middleware maps these to responses.
export class AppError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = true; // safe to send `message` to the client
  }
}

export const Errors = {
  validation: (message = 'Validation failed', details) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Missing or invalid credentials') =>
    new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message = 'Seat just taken, try another') =>
    new AppError(409, 'CONFLICT', message),
  rateLimited: (message = 'Too many requests, wait 60s') =>
    new AppError(429, 'RATE_LIMITED', message),
};
