// Core hold/release/status logic. Strong consistency comes from the Redis Lua
// hold (one winner per seat); Postgres is the durable record. If Redis is
// unreachable we fall back to a `SELECT ... FOR UPDATE` claim on Postgres.
import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { redis, isRedisReady } from '../config/redis.js';
import { writePool, readPool, withTransaction } from '../config/db.js';
import { scheduleExpiry, cancelExpiry } from '../config/queues.js';
import { publishSeatUpdate } from './cacheService.js';
import { logger } from '../utils/logger.js';
import { AppError, Errors } from '../utils/errors.js';

const HOLD_TTL = config.holdTtlSeconds; // seconds (480)
const RL_MAX = config.rateLimit.holds; // 3
const RL_WINDOW = config.rateLimit.windowSeconds; // 60

const seatKey = (eventId, seatId) => `seat:${eventId}:${seatId}`;
const rateKey = (userId) => `ratelimit:${userId}:holds`;

// ── Rate limit: max RL_MAX holds per user per RL_WINDOW seconds ──
async function enforceRateLimit(userId) {
  const key = rateKey(userId);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RL_WINDOW);
  if (count > RL_MAX) throw Errors.rateLimited('Too many requests, wait 60s');
}

async function insertHeldReservation(client, { seatId, userId, eventId, holdToken, expiresAt }) {
  await client.query(
    `INSERT INTO reservations (seat_id, user_id, event_id, status, hold_token, held_at, expires_at)
     VALUES ($1, $2, $3, 'held', $4, NOW(), $5)`,
    [seatId, userId, eventId, holdToken, expiresAt],
  );
}

/**
 * Hold a seat for the user. Returns { holdToken, expiresAt, ttl }.
 * Throws AppError 409 (already held), 429 (rate limit), 404 (no such seat).
 */
export async function holdSeat({ userId, seatId, eventId }) {
  const holdToken = crypto.randomUUID();
  const ttlMs = HOLD_TTL * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  if (isRedisReady()) {
    // Redis-critical section: only failures *here* (before the reservation is
    // written) may fall back to Postgres. A 429/409 is a real answer, not a fault.
    let held;
    try {
      await enforceRateLimit(userId);
      held = await redis.holdSeat(seatKey(eventId, seatId), userId, holdToken, HOLD_TTL);
    } catch (err) {
      if (err instanceof AppError) throw err; // rate limit (429)
      logger.warn(`[hold] redis hold failed (${err.message}); falling back to Postgres`);
      return holdSeatViaPostgres({ userId, seatId, eventId, holdToken, expiresAt });
    }
    if (held === 0) throw Errors.conflict('Seat just taken, try another');

    // Durable record. A DB error here is real — surface it, never re-insert.
    await writePool.query(
      `INSERT INTO reservations (seat_id, user_id, event_id, status, hold_token, held_at, expires_at)
       VALUES ($1, $2, $3, 'held', $4, NOW(), $5)`,
      [seatId, userId, eventId, holdToken, expiresAt],
    );

    // Side effects are best-effort; a failure does NOT void an established hold.
    try {
      await scheduleExpiry(holdToken, { holdToken, seatId, userId, eventId }, ttlMs);
    } catch (err) {
      logger.warn(`[hold] scheduleExpiry failed: ${err.message}`);
    }
    await publishSeatUpdate({ eventId, seatId, status: 'held', userId });

    logger.info(`[hold] seat=${seatId} user=${userId} token=${holdToken} (redis)`);
    return { holdToken, expiresAt: expiresAt.toISOString(), ttl: HOLD_TTL };
  }

  logger.warn('[hold] redis not ready; using Postgres fallback');
  return holdSeatViaPostgres({ userId, seatId, eventId, holdToken, expiresAt });
}

/** Redis-down fallback: claim the seat with a row lock on the primary. */
async function holdSeatViaPostgres({ userId, seatId, eventId, holdToken, expiresAt }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM seats WHERE id = $1 FOR UPDATE', [seatId]);
    if (rows.length === 0) throw Errors.notFound('Seat not found');
    if (rows[0].status !== 'available') throw Errors.conflict('Seat just taken, try another');

    await client.query('UPDATE seats SET status = $1, version = version + 1 WHERE id = $2', ['held', seatId]);
    await insertHeldReservation(client, { seatId, userId, eventId, holdToken, expiresAt });

    logger.info(`[hold] seat=${seatId} user=${userId} token=${holdToken} (postgres-fallback)`);
    // Best-effort live update (publisher may be down too).
    publishSeatUpdate({ eventId, seatId, status: 'held', userId }).catch(() => {});
    return { holdToken, expiresAt: expiresAt.toISOString(), ttl: HOLD_TTL, fallback: true };
  });
}

/** Release a hold the user owns. Used by DELETE /api/seats/:id/hold. */
export async function releaseHold({ userId, holdToken }) {
  const { rows } = await writePool.query(
    'SELECT id, seat_id, event_id, user_id, status FROM reservations WHERE hold_token = $1',
    [holdToken],
  );
  if (rows.length === 0) throw Errors.notFound('Hold not found');
  const r = rows[0];
  if (r.user_id !== userId) throw Errors.forbidden('Not your hold');
  if (r.status !== 'held') throw Errors.conflict('Hold is no longer active');

  const key = seatKey(r.event_id, r.seat_id);
  if (isRedisReady()) {
    try {
      const val = await redis.get(key);
      if (val && !val.startsWith(`${userId}:`)) throw Errors.forbidden('Not your hold');
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn('[release] redis ownership check failed:', err.message);
    }
  }

  await withTransaction(async (client) => {
    await client.query("UPDATE reservations SET status = 'cancelled' WHERE id = $1", [r.id]);
    await client.query(
      "UPDATE seats SET status = 'available', version = version + 1 WHERE id = $1 AND status = 'held'",
      [r.seat_id],
    );
  });

  if (isRedisReady()) {
    try {
      await redis.del(key);
    } catch (err) {
      logger.warn('[release] redis del failed:', err.message);
    }
  }
  await cancelExpiry(holdToken);
  await publishSeatUpdate({ eventId: r.event_id, seatId: r.seat_id, status: 'available' });
  return { released: true };
}

/** Single seat by id (from primary — used before a hold to validate event/price). */
export async function getSeatById(seatId) {
  const { rows } = await writePool.query('SELECT * FROM seats WHERE id = $1', [seatId]);
  return rows[0] || null;
}

/**
 * All seats for an event with their *effective* live status.
 * Base status comes from the replica; Redis hold keys overlay "held" + heldByMe.
 */
export async function getEventSeats(eventId, userId = null) {
  const { rows } = await readPool.query(
    `SELECT id, row_label, seat_number, category, price, status, version
       FROM seats WHERE event_id = $1
       ORDER BY row_label, seat_number`,
    [eventId],
  );

  const holds = {};
  if (isRedisReady() && rows.length) {
    try {
      const keys = rows.map((r) => seatKey(eventId, r.id));
      const vals = await redis.mget(keys);
      rows.forEach((r, i) => {
        if (vals[i]) holds[r.id] = vals[i];
      });
    } catch (err) {
      logger.warn('[seats] redis overlay failed:', err.message);
    }
  }

  return rows.map((r) => {
    let status = r.status; // available | booked | held(fallback)
    let heldByMe = false;
    const hv = holds[r.id];
    if (r.status === 'booked') {
      status = 'booked';
    } else if (hv) {
      status = 'held';
      heldByMe = Boolean(userId) && hv.startsWith(`${userId}:`);
    } else if (r.status === 'held') {
      status = 'held'; // held via Postgres fallback
    }
    return {
      id: r.id,
      row: r.row_label,
      number: r.seat_number,
      category: r.category,
      price: r.price === null ? null : Number(r.price),
      status,
      heldByMe,
      version: r.version,
    };
  });
}
