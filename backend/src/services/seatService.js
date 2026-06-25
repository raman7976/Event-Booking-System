// Core hold/release/status logic. Strong consistency comes from the Redis Lua
// hold (one winner per seat); Postgres is the durable record. If Redis is
// unreachable we fall back to a `SELECT ... FOR UPDATE` claim on Postgres.
import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { redis, isRedisReady } from '../config/redis.js';
import { writePool, readPool, withTransaction, pickReadPool } from '../config/db.js';
import { scheduleExpiry, cancelExpiry } from '../config/queues.js';
import { publishSeatUpdate, markUserWrite } from './cacheService.js';
import { logger } from '../utils/logger.js';
import { AppError, Errors } from '../utils/errors.js';
import { seatHolds } from '../config/metrics.js';

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

    // Durable record. The Redis Lua lock guarantees one *hold* per seat, but a
    // seat that was just CONFIRMED has its Redis key deleted by the confirm path —
    // so a hold acquired in that brief window could land on an already-booked
    // seat (a confirm-vs-hold race that oversells; the controller's pre-check is
    // a non-atomic read and can't close it). So we claim the seat row FOR UPDATE
    // and refuse if it's already booked, in the SAME transaction as the insert —
    // this serializes against confirm's seat UPDATE and makes Postgres the
    // authority. Any failure/rejection releases the Redis lock we hold, otherwise
    // the seat would stay phantom-held for the full TTL (480s).
    try {
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          'SELECT status FROM seats WHERE id = $1 FOR UPDATE',
          [seatId],
        );
        if (rows.length === 0) throw Errors.notFound('Seat not found');
        if (rows[0].status === 'booked') throw Errors.conflict('Seat just taken, try another');
        await insertHeldReservation(client, { seatId, userId, eventId, holdToken, expiresAt });
      });
    } catch (err) {
      try {
        await redis.del(seatKey(eventId, seatId));
      } catch (delErr) {
        logger.warn(`[hold] lock cleanup failed: ${delErr.message}`);
      }
      throw err;
    }

    // Side effects are best-effort; a failure does NOT void an established hold.
    try {
      await scheduleExpiry(holdToken, { holdToken, seatId, userId, eventId }, ttlMs);
    } catch (err) {
      logger.warn(`[hold] scheduleExpiry failed: ${err.message}`);
    }
    await publishSeatUpdate({ eventId, seatId, status: 'held', userId });

    logger.info(`[hold] seat=${seatId} user=${userId} token=${holdToken} (redis)`);
    seatHolds.inc({ path: 'redis' });
    markUserWrite(userId).catch(() => {});
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
    seatHolds.inc({ path: 'pg_fallback' });
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
  markUserWrite(userId).catch(() => {});
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
  const pool = await pickReadPool(userId);
  const { rows } = await pool.query(
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

// ─────────────────────────────────────────────────────────────────────────────
//  AI Smart Seat Recommender — Google Gemini (free tier) with heuristic fallback
// ─────────────────────────────────────────────────────────────────────────────

let geminiClient = null;
async function getGemini() {
  if (geminiClient) return geminiClient;
  const { GoogleGenAI } = await import('@google/genai');
  geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return geminiClient;
}

export function normalizePrefs(preferences) {
  if (!preferences) return new Set();
  const arr = Array.isArray(preferences) ? preferences : String(preferences).split(',');
  return new Set(arr.map((p) => p.trim().toLowerCase()).filter(Boolean));
}

const rowRank = (row) => (row || 'Z').charCodeAt(0); // 'A' (65) = front

export function buildReason(seats, prefs, total) {
  const labels = seats.map((s) => `${s.row}${s.number}`).join(', ');
  const tags = [];
  if (prefs.has('together')) tags.push('together');
  if (prefs.has('front')) tags.push('near the front');
  if (prefs.has('back')) tags.push('toward the back');
  if (prefs.has('aisle')) tags.push('on the aisle');
  const tagStr = tags.length ? ` (${tags.join(', ')})` : '';
  return `Recommended ${seats.length} seat(s) ${labels}${tagStr} for a total of ₹${total}.`;
}

/** Deterministic recommender used when Gemini is unavailable or fails. */
export function heuristicRecommend(available, groupSize, maxBudget, prefs) {
  const seats = available.filter((s) => s.price != null);
  if (!seats.length || groupSize < 1) {
    return { recommendedSeatIds: [], reason: 'No available seats match the request.' };
  }

  const wantTogether = prefs.has('together');
  const wantFront = prefs.has('front');
  const wantBack = prefs.has('back');
  const wantAisle = prefs.has('aisle');

  // "together": cheapest run of consecutive seat numbers in one row, within budget.
  if (wantTogether && groupSize > 1) {
    const byRow = {};
    for (const s of seats) (byRow[s.row] ||= []).push(s);
    const candidates = [];
    for (const row of Object.keys(byRow)) {
      const list = byRow[row].sort((a, b) => a.number - b.number);
      for (let i = 0; i + groupSize <= list.length; i += 1) {
        const window = list.slice(i, i + groupSize);
        const consecutive = window.every((s, j) => j === 0 || s.number === window[j - 1].number + 1);
        if (!consecutive) continue;
        const total = window.reduce((a, s) => a + s.price, 0);
        if (maxBudget != null && total > maxBudget) continue;
        candidates.push({ seats: window, total, row });
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => {
        if (wantFront) { const r = rowRank(a.row) - rowRank(b.row); if (r) return r; }
        if (wantBack) { const r = rowRank(b.row) - rowRank(a.row); if (r) return r; }
        return a.total - b.total;
      });
      const best = candidates[0];
      return { recommendedSeatIds: best.seats.map((s) => s.id), reason: buildReason(best.seats, prefs, best.total) };
    }
  }

  // Otherwise rank by preference, then price, and greedily fill within budget.
  let aisleSet = null;
  if (wantAisle) {
    aisleSet = new Set();
    const byRow = {};
    for (const s of seats) (byRow[s.row] ||= []).push(s);
    for (const row of Object.keys(byRow)) {
      const l = byRow[row].sort((a, b) => a.number - b.number);
      aisleSet.add(l[0].id);
      aisleSet.add(l[l.length - 1].id);
    }
  }
  const pool = [...seats].sort((a, b) => {
    if (wantFront) { const r = rowRank(a.row) - rowRank(b.row); if (r) return r; }
    if (wantBack) { const r = rowRank(b.row) - rowRank(a.row); if (r) return r; }
    if (aisleSet) { const aa = aisleSet.has(a.id) ? 0 : 1; const bb = aisleSet.has(b.id) ? 0 : 1; if (aa !== bb) return aa - bb; }
    return a.price - b.price;
  });

  const chosen = [];
  let total = 0;
  for (const s of pool) {
    if (chosen.length >= groupSize) break;
    if (maxBudget != null && total + s.price > maxBudget) continue;
    chosen.push(s);
    total += s.price;
  }
  if (chosen.length < groupSize) {
    return {
      recommendedSeatIds: chosen.map((s) => s.id),
      reason: `Only ${chosen.length} of ${groupSize} seat(s) fit the budget/preferences; showing the best available.`,
    };
  }
  return { recommendedSeatIds: chosen.map((s) => s.id), reason: buildReason(chosen, prefs, total) };
}

function buildPrompt(available, groupSize, maxBudget, prefs) {
  const seatLines = available.map((s) => `${s.id} | ${s.row}${s.number} | ${s.category} | ₹${s.price}`).join('\n');
  return [
    'You are a seat recommendation assistant for an event booking system.',
    'Available seats (id | seat | category | price):',
    seatLines,
    '',
    `Recommend exactly ${groupSize} seat(s)` +
      (prefs.length ? ` that are ${prefs.join(', ')}` : '') +
      (maxBudget != null ? ` with a combined price under ₹${maxBudget}` : '') + '.',
    'Guidance: same row for "together", lower rows (A, B) for "front", higher rows for "back", row-end seats for "aisle".',
    'Respond with ONLY JSON: {"recommendedSeatIds": ["<id>", ...], "reason": "<short explanation>"}.',
    'Only use ids from the list above and never exceed the budget.',
  ].join('\n');
}

/**
 * Recommend `groupSize` available seats matching budget + preferences.
 * Uses Gemini when GEMINI_API_KEY is set, else (or on any failure) a heuristic.
 */
export async function recommendSeats({ eventId, groupSize = 1, maxBudget = null, preferences = [] }) {
  const prefs = normalizePrefs(preferences);
  const all = await getEventSeats(eventId);
  const available = all.filter((s) => s.status === 'available');
  if (!available.length) {
    return { recommendedSeatIds: [], reason: 'No seats are currently available for this event.', source: 'none', seats: [] };
  }

  if (config.gemini.apiKey) {
    try {
      const ai = await getGemini();
      const prompt = buildPrompt(available, groupSize, maxBudget, [...prefs]);
      const resp = await ai.models.generateContent({
        model: config.gemini.model,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0.2 },
      });
      const parsed = JSON.parse((resp.text || '').trim());
      const ids = Array.isArray(parsed.recommendedSeatIds) ? parsed.recommendedSeatIds : [];
      const validIds = ids.filter((id) => available.some((s) => s.id === id));
      if (validIds.length) {
        const seats = validIds.map((id) => available.find((s) => s.id === id));
        const total = seats.reduce((a, s) => a + s.price, 0);
        return { recommendedSeatIds: validIds, reason: parsed.reason || buildReason(seats, prefs, total), source: 'gemini', model: config.gemini.model, seats };
      }
      logger.warn('[recommend] Gemini returned no valid seat ids; using heuristic');
    } catch (err) {
      logger.warn(`[recommend] Gemini failed (${err.message}); using heuristic`);
    }
  }

  const h = heuristicRecommend(available, groupSize, maxBudget, prefs);
  const seats = h.recommendedSeatIds.map((id) => available.find((s) => s.id === id)).filter(Boolean);
  return { ...h, source: 'heuristic', seats };
}
