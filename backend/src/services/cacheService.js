// Redis-backed seat snapshot + realtime emit helpers (events vertical) and the
// read-your-writes flag shared by both verticals.
import { redis, isRedisReady } from '../config/redis.js';
import { emitSeatUpdate, emitWaitlistNotify } from '../lib/emitter.js';
import { logger } from '../utils/logger.js';

const snapshotKey = (eventId) => `event:${eventId}:seats`;

/** Maintain the per-event seat snapshot hash: field=seatId value=available|held|booked */
export async function setSeatStatus(eventId, seatId, status) {
  if (!isRedisReady()) return;
  try {
    await redis.hset(snapshotKey(eventId), seatId, status);
  } catch (err) {
    logger.warn('[cache] setSeatStatus failed:', err.message);
  }
}

export async function getSeatSnapshot(eventId) {
  if (!isRedisReady()) return {};
  try {
    return await redis.hgetall(snapshotKey(eventId));
  } catch (err) {
    logger.warn('[cache] getSeatSnapshot failed:', err.message);
    return {};
  }
}

/**
 * Update the snapshot hash AND emit the live update through the Socket.IO
 * redis-adapter (delivered once, cluster-wide). Best-effort: a Redis outage is
 * logged, never thrown (the caller already persisted to PG).
 */
export async function publishSeatUpdate({ eventId, seatId, status, userId = null }) {
  await setSeatStatus(eventId, seatId, status);
  emitSeatUpdate(eventId, { seatId, status, timestamp: Date.now() });
  void userId;
}

/** Tell a specific user (whichever node holds their socket) a seat opened up. */
export async function publishWaitlistNotify({ eventId, userId, seatId = null }) {
  emitWaitlistNotify(userId, { eventId, seatId, timestamp: Date.now() });
}

/**
 * Read-your-writes: stamp the user after any booking-state mutation; for the
 * next few seconds their user-scoped reads are served from the primary so a
 * lagging replica can never show them stale own-state.
 */
export async function markUserWrite(userId) {
  if (!userId || !isRedisReady()) return;
  try {
    await redis.set(`ryw:${userId}`, '1', 'EX', 10);
  } catch {
    /* best effort */
  }
}
