// AI ops insights for the bus vertical.
//
// Division of labor: SQL computes the FACTS (per-rider outcome aggregates,
// per-route demand curves); Gemini provides the JUDGMENT layer — weighing the
// patterns, writing a human-readable rationale, and suggesting an action.
// Every analysis has a deterministic heuristic fallback (same pattern as the
// seat recommender), so the features work fully without an API key.
//
// Privacy: only roll numbers and aggregate counts are sent to the LLM —
// never names or emails. Flags are ADVISORY; admins decide, nothing is
// enforced automatically.
import { config } from '../config/env.js';
import { writePool, readPool, withTransaction } from '../config/db.js';
import { logger } from '../utils/logger.js';

const MISS_STATUSES = ['no_show', 'auto_released'];

let geminiClient = null;
async function getGemini() {
  if (geminiClient) return geminiClient;
  const { GoogleGenAI } = await import('@google/genai');
  geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return geminiClient;
}

async function askGeminiJson(prompt) {
  const ai = await getGemini();
  const resp = await ai.models.generateContent({
    model: config.gemini.model,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  return JSON.parse((resp.text || '').trim());
}

// ─────────────────────────────────────────────────────────────────────────────
//  Rider reliability ("books but doesn't board")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-rider booking outcomes over the window. Pre-filtered to riders with at
 * least 3 bookings and 1 miss (no_show or auto_released), capped at 40 by miss
 * rate — nobody else is worth an LLM's attention (or its token bill).
 */
export async function getRiderStats(windowDays = 30) {
  const { rows } = await readPool.query(
    `WITH riders AS (
       SELECT b.user_id,
              COUNT(*)::int                                                AS total,
              COUNT(*) FILTER (WHERE b.status = 'confirmed')::int          AS confirmed,
              COUNT(*) FILTER (WHERE b.status = 'no_show')::int            AS no_shows,
              COUNT(*) FILTER (WHERE b.status = 'auto_released')::int      AS auto_released,
              COUNT(*) FILTER (WHERE b.status = 'declined')::int           AS declined,
              COUNT(*) FILTER (WHERE b.status = 'cancelled')::int          AS cancelled,
              COUNT(*) FILTER (
                WHERE b.status = ANY($2)
                  AND EXISTS (SELECT 1 FROM bus_waitlist w WHERE w.trip_id = b.trip_id)
              )::int                                                       AS blocked_waiters
         FROM bus_bookings b
         JOIN bus_trips t ON t.id = b.trip_id
        WHERE t.service_date >= CURRENT_DATE - $1::int
        GROUP BY b.user_id
     )
     SELECT r.*, u.name, u.roll_number,
            (r.no_shows + r.auto_released) AS misses,
            ROUND((r.no_shows + r.auto_released)::numeric / r.total, 3)::float AS miss_rate,
            recent.pattern AS recent
       FROM riders r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (
         SELECT string_agg(s.status, ' > ' ORDER BY s.rn) AS pattern
           FROM (
             SELECT b2.status, ROW_NUMBER() OVER (ORDER BY b2.created_at DESC) AS rn
               FROM bus_bookings b2
               JOIN bus_trips t2 ON t2.id = b2.trip_id
              WHERE b2.user_id = r.user_id
                AND t2.service_date >= CURRENT_DATE - $1::int
              ORDER BY b2.created_at DESC
              LIMIT 5
           ) s
       ) recent ON TRUE
      WHERE r.total >= 3 AND (r.no_shows + r.auto_released) >= 1
      ORDER BY miss_rate DESC, misses DESC
      LIMIT 40`,
    [windowDays, MISS_STATUSES],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    rollNumber: r.roll_number,
    name: r.name,
    total: r.total,
    confirmed: r.confirmed,
    noShows: r.no_shows,
    autoReleased: r.auto_released,
    declined: r.declined,
    cancelled: r.cancelled,
    misses: r.misses,
    missRate: r.miss_rate,
    blockedWaiters: r.blocked_waiters,
    recent: r.recent || '',
  }));
}

/** Deterministic tiering used when Gemini is unavailable (or as its baseline). */
export function heuristicFlags(profiles) {
  return profiles.map((p) => {
    let tier = 'low';
    let action = 'none';
    if (p.missRate >= 0.5 && p.misses >= 3) {
      tier = 'high';
      action = 'cooldown';
    } else if (p.missRate >= 0.3 && p.misses >= 2) {
      tier = 'medium';
      action = 'warn';
    }
    const blocked = p.blockedWaiters > 0 ? `, blocking ${p.blockedWaiters} waitlisted rider(s)` : '';
    return {
      ...p,
      tier,
      action,
      rationale: `Missed ${p.misses} of ${p.total} bookings (${Math.round(p.missRate * 100)}%) in the window${blocked}. Recent: ${p.recent}.`,
    };
  });
}

const TIERS = ['low', 'medium', 'high'];
const ACTIONS = ['none', 'warn', 'cooldown'];

function buildRiderPrompt(profiles) {
  const data = profiles.map(({ rollNumber, total, confirmed, misses, noShows, autoReleased, declined, cancelled, missRate, blockedWaiters, recent }) =>
    ({ rollNumber, total, confirmed, misses, noShows, autoReleased, declined, cancelled, missRate, blockedWaiters, recent }));
  return [
    'You are the reliability analyst for a free campus bus booking service.',
    'A "miss" means the rider booked a seat but never boarded (no_show) or never confirmed and the seat was auto-released — both waste seats others wanted.',
    `Rider aggregates for the last 30 days (JSON): ${JSON.stringify(data)}`,
    '',
    'Classify EVERY rider listed. Be fair: a single miss among many confirmed rides is low risk;',
    'repeated misses, a high missRate, or blocking waitlisted riders is serious. "declined"/"cancelled" are responsible behaviors, not misses.',
    'Respond ONLY with JSON: {"flags":[{"rollNumber":"...","tier":"low|medium|high","action":"none|warn|cooldown","rationale":"<=140 chars, specific, cite their numbers"}]}',
  ].join('\n');
}

/**
 * Analyze riders and persist the result (each run REPLACES the previous flag
 * set, so riders who improved drop off). Returns { source, model?, flags }.
 */
export async function analyzeRiders(windowDays = 30) {
  const profiles = await getRiderStats(windowDays);
  if (!profiles.length) {
    await writePool.query('DELETE FROM bus_rider_flags');
    return { source: 'none', flags: [] };
  }

  let flags = null;
  let source = 'heuristic';
  let model = null;

  if (config.gemini.apiKey) {
    try {
      const parsed = await askGeminiJson(buildRiderPrompt(profiles));
      const byRoll = new Map(profiles.map((p) => [p.rollNumber, p]));
      const valid = (parsed.flags || [])
        .filter((f) => byRoll.has(f.rollNumber))
        .map((f) => ({
          ...byRoll.get(f.rollNumber),
          tier: TIERS.includes(f.tier) ? f.tier : 'low',
          action: ACTIONS.includes(f.action) ? f.action : 'none',
          rationale: String(f.rationale || '').slice(0, 200),
        }));
      if (valid.length) {
        flags = valid;
        source = 'gemini';
        model = config.gemini.model;
      } else {
        logger.warn('[insights] Gemini returned no valid rider flags; using heuristic');
      }
    } catch (err) {
      logger.warn(`[insights] Gemini rider analysis failed (${err.message}); using heuristic`);
    }
  }
  if (!flags) flags = heuristicFlags(profiles);

  await withTransaction(async (client) => {
    await client.query('DELETE FROM bus_rider_flags');
    for (const f of flags) {
      await client.query(
        `INSERT INTO bus_rider_flags (user_id, tier, rationale, suggested_action, stats, source, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE
           SET tier = EXCLUDED.tier, rationale = EXCLUDED.rationale,
               suggested_action = EXCLUDED.suggested_action, stats = EXCLUDED.stats,
               source = EXCLUDED.source, model = EXCLUDED.model, created_at = NOW()`,
        [
          f.userId, f.tier, f.rationale, f.action,
          JSON.stringify({
            windowDays, total: f.total, confirmed: f.confirmed, misses: f.misses,
            noShows: f.noShows, autoReleased: f.autoReleased, declined: f.declined,
            cancelled: f.cancelled, missRate: f.missRate, blockedWaiters: f.blockedWaiters,
            recent: f.recent,
          }),
          source, model,
        ],
      );
    }
  });

  logger.info(`[insights] rider analysis: ${flags.length} flagged (source=${source})`);
  return { source, model, flags };
}

export async function listFlags() {
  const { rows } = await readPool.query(
    `SELECT f.tier, f.rationale, f.suggested_action, f.stats, f.source, f.model, f.created_at,
            u.id AS user_id, u.name, u.roll_number, u.no_show_count
       FROM bus_rider_flags f
       JOIN users u ON u.id = f.user_id
      ORDER BY CASE f.tier WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               (f.stats->>'missRate')::float DESC NULLS LAST`,
  );
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    rollNumber: r.roll_number,
    noShowCount: r.no_show_count,
    tier: r.tier,
    action: r.suggested_action,
    rationale: r.rationale,
    stats: r.stats,
    source: r.source,
    model: r.model,
    analyzedAt: r.created_at,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Capacity advisor
// ─────────────────────────────────────────────────────────────────────────────

/** Per-timetable-row demand over departed trips in the window. */
export async function getRouteDemand(windowDays = 21) {
  const { rows } = await readPool.query(
    `SELECT s.id, s.bus_no, s.origin, s.destination, s.departure_time, s.capacity,
            s.pattern, s.weekday_only, s.active,
            COUNT(t.id)::int AS trips,
            ROUND(AVG(t.booked_count::numeric / NULLIF(t.capacity, 0)), 3)::float AS avg_fill,
            MAX(t.booked_count)::int AS peak_booked,
            COUNT(*) FILTER (WHERE t.booked_count >= t.capacity)::int AS full_trips,
            ROUND(AVG(wl.cnt), 2)::float AS avg_waitlist,
            ROUND(AVG(ar.cnt), 2)::float AS avg_auto_released,
            ROUND(AVG(ttf.mins)::numeric, 1)::float AS avg_minutes_to_full
       FROM bus_schedules s
       JOIN bus_trips t ON t.schedule_id = s.id
            AND t.status = 'departed'
            AND t.service_date >= CURRENT_DATE - $1::int
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt FROM bus_waitlist w WHERE w.trip_id = t.id
       ) wl ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt FROM bus_bookings b
          WHERE b.trip_id = t.id AND b.status = 'auto_released'
       ) ar ON TRUE
       LEFT JOIN LATERAL (
         SELECT CASE WHEN t.booked_count >= t.capacity THEN
           EXTRACT(EPOCH FROM ((MAX(b2.created_at) AT TIME ZONE 'UTC')
             - (t.departure_at - make_interval(secs => $2)))) / 60
         END AS mins
           FROM bus_bookings b2 WHERE b2.trip_id = t.id
       ) ttf ON TRUE
      GROUP BY s.id
     HAVING COUNT(t.id) >= 1
      ORDER BY avg_fill DESC`,
    [windowDays, config.bus.openSeconds],
  );

  return rows.map((r) => ({
    scheduleId: r.id,
    busNo: r.bus_no,
    origin: r.origin,
    destination: r.destination,
    departureTime: String(r.departure_time).slice(0, 5),
    pattern: r.pattern,
    weekdayOnly: r.weekday_only,
    active: r.active,
    capacity: r.capacity,
    trips: r.trips,
    avgFill: r.avg_fill ?? 0,
    peakBooked: r.peak_booked,
    fullTrips: r.full_trips,
    avgWaitlist: r.avg_waitlist ?? 0,
    avgAutoReleased: r.avg_auto_released ?? 0,
    avgMinutesToFull: r.avg_minutes_to_full,
  }));
}

/** Deterministic advice used when Gemini is unavailable. */
export function heuristicAdvice(demand) {
  return demand.map((d) => {
    if (d.avgFill >= 0.95 && d.avgWaitlist > 0) {
      const suggested = Math.min(100, d.capacity + Math.ceil(d.avgWaitlist));
      return {
        ...d,
        recommendation: 'increase',
        suggestedCapacity: suggested,
        reason: `Fills to ${Math.round(d.avgFill * 100)}% with ~${d.avgWaitlist} riders waiting on average — add ${suggested - d.capacity} seats.`,
      };
    }
    if (d.avgFill < 0.35 && d.trips >= 5) {
      const suggested = Math.max(10, d.peakBooked + 5);
      return {
        ...d,
        recommendation: 'decrease',
        suggestedCapacity: Math.min(suggested, d.capacity),
        reason: `Averages ${Math.round(d.avgFill * 100)}% fill over ${d.trips} trips (peak ${d.peakBooked}) — a smaller bus would do.`,
      };
    }
    return { ...d, recommendation: 'keep', suggestedCapacity: null, reason: `Healthy utilization at ${Math.round(d.avgFill * 100)}% over ${d.trips} trip(s).` };
  });
}

const RECS = ['increase', 'decrease', 'keep'];

function buildDemandPrompt(demand) {
  const data = demand.map(({ scheduleId, busNo, origin, destination, departureTime, capacity, trips, avgFill, peakBooked, fullTrips, avgWaitlist, avgAutoReleased, avgMinutesToFull }) =>
    ({ scheduleId, busNo, route: `${origin}->${destination}`, departureTime, capacity, trips, avgFill, peakBooked, fullTrips, avgWaitlist, avgAutoReleased, avgMinutesToFull }));
  return [
    'You are the transport-capacity planner for a campus bus service.',
    'Per timetable row, demand stats over recent departed trips (avgFill is 0..1; avgWaitlist is riders left waiting; avgMinutesToFull is how fast full buses filled after booking opened):',
    JSON.stringify(data),
    '',
    'For EVERY row recommend capacity action. Buses range 10-100 seats. Only recommend "increase" when demand clearly exceeds capacity (high fill + waitlist), "decrease" when persistently underused across several trips.',
    'Respond ONLY with JSON: {"advice":[{"scheduleId":"...","recommendation":"increase|decrease|keep","suggestedCapacity":<int or null>,"reason":"<=160 chars citing the numbers"}]}',
  ].join('\n');
}

export async function adviseCapacity(windowDays = 21) {
  const demand = await getRouteDemand(windowDays);
  if (!demand.length) return { source: 'none', advice: [] };

  if (config.gemini.apiKey) {
    try {
      const parsed = await askGeminiJson(buildDemandPrompt(demand));
      const byId = new Map(demand.map((d) => [d.scheduleId, d]));
      const valid = (parsed.advice || [])
        .filter((a) => byId.has(a.scheduleId))
        .map((a) => ({
          ...byId.get(a.scheduleId),
          recommendation: RECS.includes(a.recommendation) ? a.recommendation : 'keep',
          suggestedCapacity:
            Number.isInteger(a.suggestedCapacity) && a.suggestedCapacity >= 10 && a.suggestedCapacity <= 100
              ? a.suggestedCapacity
              : null,
          reason: String(a.reason || '').slice(0, 200),
        }));
      if (valid.length) {
        return { source: 'gemini', model: config.gemini.model, advice: valid };
      }
      logger.warn('[insights] Gemini returned no valid capacity advice; using heuristic');
    } catch (err) {
      logger.warn(`[insights] Gemini capacity advice failed (${err.message}); using heuristic`);
    }
  }
  return { source: 'heuristic', advice: heuristicAdvice(demand) };
}
