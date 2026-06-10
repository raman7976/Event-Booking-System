// Generic Redis fixed-window rate limiter. Fails OPEN if Redis is unavailable.
import { redis, isRedisReady } from '../config/redis.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function rateLimiter({ max = 60, windowSeconds = 60, keyPrefix = 'rl' } = {}) {
  return async (req, _res, next) => {
    if (!isRedisReady()) return next(); // don't block requests when Redis is down
    const identity = req.user?.id || req.ip;
    const key = `ratelimit:${keyPrefix}:${identity}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      if (count > max) return next(Errors.rateLimited('Too many requests, wait 60s'));
      next();
    } catch (err) {
      logger.warn('[rateLimiter] failing open:', err.message);
      next();
    }
  };
}
