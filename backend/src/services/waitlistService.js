// Waitlist backed by a Redis sorted set (score = join timestamp; lower = higher
// priority) with a durable mirror in Postgres. ZPOPMIN gives the next person.
import { redis, isRedisReady } from '../config/redis.js';
import { writePool, readPool } from '../config/db.js';
import { logger } from '../utils/logger.js';

const wlKey = (eventId) => `waitlist:${eventId}`;

export async function joinWaitlist(eventId, userId) {
  const score = Date.now();
  if (isRedisReady()) {
    try {
      await redis.zadd(wlKey(eventId), 'NX', score, userId);
    } catch (err) {
      logger.warn('[waitlist] zadd failed:', err.message);
    }
  }
  await writePool.query(
    `INSERT INTO waitlist (event_id, user_id, priority_score)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    [eventId, userId, score],
  );
  return getWaitlistInfo(eventId, userId);
}

export async function leaveWaitlist(eventId, userId) {
  if (isRedisReady()) {
    try {
      await redis.zrem(wlKey(eventId), userId);
    } catch (err) {
      logger.warn('[waitlist] zrem failed:', err.message);
    }
  }
  await writePool.query('DELETE FROM waitlist WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  return { left: true };
}

/** Remove and return the highest-priority waiting user id (or null). */
export async function popNextWaitlisted(eventId) {
  if (isRedisReady()) {
    try {
      const res = await redis.zpopmin(wlKey(eventId)); // ['userId','score'] or []
      if (res && res.length) return res[0];
      return null;
    } catch (err) {
      logger.warn('[waitlist] zpopmin failed:', err.message);
    }
  }
  // Redis-down fallback: lowest score not yet notified, then mark it notified.
  const { rows } = await writePool.query(
    `SELECT user_id FROM waitlist
     WHERE event_id = $1 AND notified_at IS NULL
     ORDER BY priority_score ASC LIMIT 1`,
    [eventId],
  );
  return rows.length ? rows[0].user_id : null;
}

export async function getWaitlistInfo(eventId, userId) {
  if (isRedisReady()) {
    try {
      const [rank, size] = await Promise.all([
        redis.zrank(wlKey(eventId), userId),
        redis.zcard(wlKey(eventId)),
      ]);
      return { onWaitlist: rank !== null, position: rank === null ? null : rank + 1, size };
    } catch (err) {
      logger.warn('[waitlist] info failed:', err.message);
    }
  }
  const { rows } = await readPool.query(
    'SELECT COUNT(*)::int AS size FROM waitlist WHERE event_id = $1',
    [eventId],
  );
  return { onWaitlist: false, position: null, size: rows[0]?.size || 0 };
}
