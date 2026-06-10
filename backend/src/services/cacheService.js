// Redis-backed seat snapshot + the pub/sub fan-out used for live updates.
// (The AI Smart Seat Recommender is added to this service in a later section.)
import { publisher, redis, isRedisReady } from '../config/redis.js';
import { logger } from '../utils/logger.js';

export const SEAT_UPDATES_CHANNEL = 'seat-updates';
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
 * Update the snapshot hash AND publish to the "seat-updates" channel so every
 * node instance can fan the change out to its WebSocket room. Best-effort: a
 * Redis outage is logged, never thrown (the caller already persisted to PG).
 */
export async function publishSeatUpdate({ eventId, seatId, status, userId = null }) {
  await setSeatStatus(eventId, seatId, status);
  if (!isRedisReady()) {
    logger.warn('[cache] publishSeatUpdate skipped — redis down');
    return;
  }
  const payload = JSON.stringify({ eventId, seatId, status, userId, timestamp: Date.now() });
  try {
    await publisher.publish(SEAT_UPDATES_CHANNEL, payload);
  } catch (err) {
    logger.warn('[cache] publish failed:', err.message);
  }
}
