// Idempotent mutations via the `Idempotency-Key` header.
//
// First request with a key claims it (SET NX) and stores the JSON response it
// eventually produced; any replay with the same key gets that stored response
// back — so a client retrying after a lost response can never double-execute.
// A concurrent duplicate (key claimed, response not yet stored) gets a 409.
// Fails OPEN when Redis is down: better to risk a retry than block bookings
// (the DB-level unique indexes are the final backstop).
import { redis, isRedisReady } from '../config/redis.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function idempotency({ ttlSeconds = 86400 } = {}) {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!key || !req.user || !isRedisReady()) return next();
    if (key.length > 128) return next(Errors.validation('Idempotency-Key too long'));

    const rkey = `idem:${req.user.id}:${key}`;
    try {
      const claimed = await redis.set(rkey, JSON.stringify({ state: 'pending' }), 'EX', ttlSeconds, 'NX');
      if (claimed === null) {
        const stored = JSON.parse((await redis.get(rkey)) || '{}');
        if (stored.state === 'done') {
          res.setHeader('Idempotency-Replayed', 'true');
          return res.status(stored.status).json(stored.body);
        }
        return next(Errors.conflict('A request with this Idempotency-Key is already in flight'));
      }

      // Capture whatever this request responds with.
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        redis
          .set(rkey, JSON.stringify({ state: 'done', status: res.statusCode, body }), 'EX', ttlSeconds)
          .catch((err) => logger.warn('[idempotency] store failed:', err.message));
        return originalJson(body);
      };
      next();
    } catch (err) {
      logger.warn('[idempotency] failing open:', err.message);
      next();
    }
  };
}
