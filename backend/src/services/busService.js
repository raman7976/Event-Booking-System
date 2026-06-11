// Campus bus domain logic.
//
// Concurrency model (deliberately different from the events vertical's Redis
// Lua locks): seats are a counter claimed with one atomic conditional UPDATE
//   UPDATE bus_trips SET booked_count = booked_count + 1
//    WHERE id = $1 AND status IN (...) AND booked_count < capacity
// inside the same transaction as the booking INSERT, with UNIQUE(trip_id,
// user_id) blocking double-booking. Postgres row locking makes over-booking
// impossible; no external coordinator needed at campus-bus scale.
//
// Lifecycle (driven by BullMQ delayed jobs in workers/busWorker.js):
//   scheduled --T-open--> open --T-confirm--> confirming --T-release--> (sweep)
//   --departure--> departed
import { config } from '../config/env.js';
import { writePool, readPool, withTransaction } from '../config/db.js';
import { publisher, isRedisReady } from '../config/redis.js';
import { scheduleBusJob, enqueueEmail } from '../config/queues.js';
import { publishWaitlistNotify } from './cacheService.js';
import { logger } from '../utils/logger.js';
import { Errors } from '../utils/errors.js';

export const TRIP_UPDATES_CHANNEL = 'trip-updates';

// ── time helpers ──
export const tripTimes = (departureAt) => {
  const dep = new Date(departureAt).getTime();
  return {
    opensAt: new Date(dep - config.bus.openSeconds * 1000),
    confirmAt: new Date(dep - config.bus.confirmSeconds * 1000),
    releaseAt: new Date(dep - config.bus.autoReleaseSeconds * 1000),
    departureAt: new Date(dep),
  };
};

const tripLabel = (t) =>
  `Bus ${t.bus_no} · ${t.origin} → ${t.destination} · ${new Date(t.departure_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

// ── live fan-out ──
export async function publishTripUpdate(tripId, client = null) {
  try {
    const q = client || writePool;
    const { rows } = await q.query(
      `SELECT t.id, t.status, t.booked_count, t.capacity,
              (SELECT COUNT(*)::int FROM bus_waitlist w WHERE w.trip_id = t.id AND w.promoted_at IS NULL) AS waitlist
         FROM bus_trips t WHERE t.id = $1`,
      [tripId],
    );
    if (!rows.length || !isRedisReady()) return;
    const t = rows[0];
    await publisher.publish(
      TRIP_UPDATES_CHANNEL,
      JSON.stringify({
        tripId: t.id,
        status: t.status,
        booked: t.booked_count,
        capacity: t.capacity,
        waitlist: t.waitlist,
        timestamp: Date.now(),
      }),
    );
  } catch (err) {
    logger.warn('[bus] publishTripUpdate failed:', err.message);
  }
}

// ── trip generation (idempotent per (schedule, date)) ──
export async function isHolidayOrWeekend(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00`).getDay(); // 0=Sun..6=Sat
  if (dow === 0 || dow === 6) return true;
  const { rows } = await writePool.query('SELECT 1 FROM holidays WHERE day = $1', [dateStr]);
  return rows.length > 0;
}

/**
 * Create bus_trips for a YYYY-MM-DD date from the timetable and schedule each
 * trip's lifecycle jobs. Safe to re-run (ON CONFLICT DO NOTHING + stable job ids).
 */
export async function generateTripsForDate(dateStr) {
  const weekend = await isHolidayOrWeekend(dateStr);
  const dow = new Date(`${dateStr}T12:00:00`).getDay();

  const { rows: schedules } = await writePool.query(
    weekend
      ? `SELECT * FROM bus_schedules WHERE active AND pattern = 'weekend_holiday'`
      : `SELECT * FROM bus_schedules WHERE active AND pattern = 'weekday'
           AND (weekday_only IS NULL OR weekday_only = $1)`,
    weekend ? [] : [dow],
  );

  let created = 0;
  for (const s of schedules) {
    // departure_time is TIME ('HH:MM:SS'); interpret in the server TZ.
    const departureAt = new Date(`${dateStr}T${s.departure_time}`);
    if (Number.isNaN(departureAt.getTime())) continue;

    const { rows } = await writePool.query(
      `INSERT INTO bus_trips (schedule_id, service_date, departure_at, capacity, status)
       VALUES ($1, $2, $3, $4, 'scheduled')
       ON CONFLICT (schedule_id, service_date) DO NOTHING
       RETURNING id`,
      [s.id, dateStr, departureAt, s.capacity],
    );
    if (rows.length) created += 1;
  }

  // Self-healing: (re)schedule lifecycle jobs for EVERY trip of the date, not
  // just freshly created ones. Stable job ids skip still-pending jobs, and all
  // phase handlers are SQL-idempotent, so re-running an already-executed phase
  // is a no-op — a worker that missed a phase (redeploy, crash) catches up here.
  const { rows: trips } = await writePool.query(
    `SELECT id, departure_at FROM bus_trips
      WHERE service_date = $1 AND status NOT IN ('departed','cancelled')`,
    [dateStr],
  );
  for (const t of trips) {
    await scheduleTripLifecycle(t.id, t.departure_at);
  }

  logger.info(`[bus] generated ${created} trip(s) for ${dateStr}, rescheduled jobs for ${trips.length} (${weekend ? 'weekend/holiday' : 'weekday'} timetable)`);
  return created;
}

/** Queue the four lifecycle jobs with stable ids; past phases run immediately. */
export async function scheduleTripLifecycle(tripId, departureAt) {
  const { opensAt, confirmAt, releaseAt } = tripTimes(departureAt);
  const now = Date.now();
  const delay = (d) => Math.max(0, d.getTime() - now);
  await scheduleBusJob('open-trip', { tripId }, delay(opensAt), `open-${tripId}`);
  await scheduleBusJob('confirm-phase', { tripId }, delay(confirmAt), `confirm-${tripId}`);
  await scheduleBusJob('auto-release', { tripId }, delay(releaseAt), `release-${tripId}`);
  await scheduleBusJob('depart-trip', { tripId }, delay(new Date(departureAt)), `depart-${tripId}`);
}

// ── lifecycle transitions (called by the worker) ──
export async function openTrip(tripId) {
  const { rowCount } = await writePool.query(
    "UPDATE bus_trips SET status = 'open' WHERE id = $1 AND status = 'scheduled'",
    [tripId],
  );
  if (rowCount) await publishTripUpdate(tripId);
  return { opened: Boolean(rowCount) };
}

export async function startConfirmPhase(tripId) {
  const { rowCount } = await writePool.query(
    "UPDATE bus_trips SET status = 'confirming' WHERE id = $1 AND status IN ('scheduled','open')",
    [tripId],
  );
  if (rowCount) await publishTripUpdate(tripId);
  return { confirming: Boolean(rowCount) };
}

/**
 * T-release sweep: every still-'assigned' booking is auto-released (holder
 * no-show++), each freed seat is offered to the waitlist FIFO.
 */
export async function releaseUnconfirmed(tripId) {
  const result = await withTransaction(async (client) => {
    const { rows: stale } = await client.query(
      `SELECT b.id, b.user_id FROM bus_bookings b
        WHERE b.trip_id = $1 AND b.status = 'assigned'
        FOR UPDATE`,
      [tripId],
    );
    const promotions = [];
    for (const b of stale) {
      await client.query("UPDATE bus_bookings SET status = 'auto_released' WHERE id = $1", [b.id]);
      await client.query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [b.user_id]);
      await client.query(
        'UPDATE bus_trips SET booked_count = booked_count - 1 WHERE id = $1 AND booked_count > 0',
        [tripId],
      );
      const promoted = await promoteNext(client, tripId);
      if (promoted) promotions.push(promoted);
    }
    return { released: stale.length, promotions };
  });

  if (result.released) {
    await publishTripUpdate(tripId);
    await notifyPromotions(tripId, result.promotions);
  }
  logger.info(`[bus] sweep trip=${tripId}: released ${result.released}, promoted ${result.promotions.length}`);
  return result;
}

export async function departTrip(tripId) {
  const result = await withTransaction(async (client) => {
    // Anyone still merely 'assigned' at departure is a no-show.
    const { rows: silent } = await client.query(
      `UPDATE bus_bookings SET status = 'no_show'
        WHERE trip_id = $1 AND status = 'assigned'
        RETURNING user_id`,
      [tripId],
    );
    for (const s of silent) {
      await client.query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [s.user_id]);
    }
    const { rowCount } = await client.query(
      "UPDATE bus_trips SET status = 'departed' WHERE id = $1 AND status NOT IN ('departed','cancelled')",
      [tripId],
    );
    return { departed: Boolean(rowCount), noShows: silent.length };
  });
  if (result.departed) await publishTripUpdate(tripId);
  return result;
}

// ── booking ──
const ACTIVE = ['assigned', 'confirmed'];

/**
 * Assign a seat. Free, one per user per trip, no seat selection — within the
 * confirm phase a fresh booking is immediately 'confirmed'. If people are
 * waiting, direct booking is refused (the waitlist has priority).
 */
export async function bookSeat({ tripId, userId }) {
  return withTransaction(async (client) => {
    const { rows: trips } = await client.query('SELECT * FROM bus_trips WHERE id = $1 FOR UPDATE', [tripId]);
    if (!trips.length) throw Errors.notFound('Trip not found');
    const trip = trips[0];

    if (trip.status === 'scheduled') {
      const { opensAt } = tripTimes(trip.departure_at);
      throw Errors.conflict(`Booking opens at ${opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (trip.status !== 'open' && trip.status !== 'confirming') {
      throw Errors.conflict('Booking for this trip is closed');
    }

    const { rows: waiting } = await client.query(
      'SELECT 1 FROM bus_waitlist WHERE trip_id = $1 AND promoted_at IS NULL LIMIT 1',
      [tripId],
    );
    if (waiting.length) throw Errors.conflict('Freed seats go to the waitlist first — join the waitlist');

    const status = trip.status === 'confirming' ? 'confirmed' : 'assigned';
    const confirmedAt = status === 'confirmed' ? new Date() : null;

    // Re-activate a cancelled/declined/released row or create a fresh one;
    // an ACTIVE existing booking falls through with zero rows -> 409.
    const { rows: booking } = await client.query(
      `INSERT INTO bus_bookings (trip_id, user_id, status, confirmed_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (trip_id, user_id) DO UPDATE
         SET status = EXCLUDED.status,
             created_at = NOW(),
             confirmed_at = EXCLUDED.confirmed_at
         WHERE bus_bookings.status IN ('cancelled','declined','auto_released','no_show')
       RETURNING id, status`,
      [tripId, userId, status, confirmedAt],
    );
    if (!booking.length) throw Errors.conflict('You already have a seat on this trip');

    const { rowCount: claimed } = await client.query(
      `UPDATE bus_trips SET booked_count = booked_count + 1
        WHERE id = $1 AND booked_count < capacity`,
      [tripId],
    );
    if (!claimed) throw Errors.conflict('Bus is full — join the waitlist');

    publishTripUpdate(tripId).catch(() => {});
    return { bookingId: booking[0].id, status: booking[0].status, seatNumber: null };
  });
}

/** Free an active seat (cancel before/decline during the confirm phase). */
async function freeSeat({ tripId, userId, newStatus }) {
  const result = await withTransaction(async (client) => {
    const { rows: trips } = await client.query(
      'SELECT status FROM bus_trips WHERE id = $1 FOR UPDATE',
      [tripId],
    );
    if (!trips.length) throw Errors.notFound('Trip not found');
    if (trips[0].status === 'departed' || trips[0].status === 'cancelled') {
      throw Errors.conflict('This trip is closed');
    }
    const { rows } = await client.query(
      `UPDATE bus_bookings SET status = $3
        WHERE trip_id = $1 AND user_id = $2 AND status = ANY($4)
        RETURNING id`,
      [tripId, userId, newStatus, ACTIVE],
    );
    if (!rows.length) throw Errors.notFound('No active seat on this trip');
    await client.query(
      'UPDATE bus_trips SET booked_count = booked_count - 1 WHERE id = $1 AND booked_count > 0',
      [tripId],
    );
    const promoted = await promoteNext(client, tripId);
    return { promotions: promoted ? [promoted] : [] };
  });
  await publishTripUpdate(tripId);
  await notifyPromotions(tripId, result.promotions);
  return { released: true, promoted: result.promotions.length };
}

export const cancelBooking = (args) => freeSeat({ ...args, newStatus: 'cancelled' });
export const declineBoarding = (args) => freeSeat({ ...args, newStatus: 'declined' });

/** "I'm boarding" — only meaningful during the confirm window. */
export async function confirmBoarding({ tripId, userId }) {
  const { rows: trips } = await writePool.query('SELECT * FROM bus_trips WHERE id = $1', [tripId]);
  if (!trips.length) throw Errors.notFound('Trip not found');
  const trip = trips[0];
  const { confirmAt } = tripTimes(trip.departure_at);
  if (Date.now() < confirmAt.getTime()) {
    throw Errors.conflict(`Boarding confirmation opens at ${confirmAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  }
  if (trip.status === 'departed' || trip.status === 'cancelled') {
    throw Errors.conflict('This trip is closed');
  }

  const { rows } = await writePool.query(
    `UPDATE bus_bookings SET status = 'confirmed', confirmed_at = NOW()
      WHERE trip_id = $1 AND user_id = $2 AND status = 'assigned'
      RETURNING id`,
    [tripId, userId],
  );
  if (!rows.length) {
    const { rows: existing } = await writePool.query(
      'SELECT status FROM bus_bookings WHERE trip_id = $1 AND user_id = $2',
      [tripId, userId],
    );
    if (existing[0]?.status === 'confirmed') return { confirmed: true, already: true };
    throw Errors.notFound('No active seat on this trip');
  }
  await publishTripUpdate(tripId);
  return { confirmed: true };
}

// ── waitlist (FIFO, public) ──
export async function joinBusWaitlist({ tripId, userId }) {
  return withTransaction(async (client) => {
    const { rows: trips } = await client.query('SELECT * FROM bus_trips WHERE id = $1 FOR UPDATE', [tripId]);
    if (!trips.length) throw Errors.notFound('Trip not found');
    const trip = trips[0];
    if (trip.status !== 'open' && trip.status !== 'confirming') {
      throw Errors.conflict('This trip is not accepting riders');
    }
    const { rows: mine } = await client.query(
      'SELECT status FROM bus_bookings WHERE trip_id = $1 AND user_id = $2',
      [tripId, userId],
    );
    if (mine.length && ACTIVE.includes(mine[0].status)) {
      throw Errors.conflict('You already have a seat on this trip');
    }
    if (trip.booked_count < trip.capacity) {
      throw Errors.conflict('Seats are still available — book directly');
    }

    const { rows } = await client.query(
      `INSERT INTO bus_waitlist (trip_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (trip_id, user_id) DO NOTHING
       RETURNING id`,
      [tripId, userId],
    );
    if (!rows.length) throw Errors.conflict("You're already on this waitlist");

    const { rows: pos } = await client.query(
      `SELECT COUNT(*)::int AS position FROM bus_waitlist
        WHERE trip_id = $1 AND promoted_at IS NULL AND joined_at <= (SELECT joined_at FROM bus_waitlist WHERE id = $2)`,
      [tripId, rows[0].id],
    );
    publishTripUpdate(tripId).catch(() => {});
    return { joined: true, position: pos[0].position };
  });
}

export async function leaveBusWaitlist({ tripId, userId }) {
  const { rowCount } = await writePool.query(
    'DELETE FROM bus_waitlist WHERE trip_id = $1 AND user_id = $2 AND promoted_at IS NULL',
    [tripId, userId],
  );
  if (!rowCount) throw Errors.notFound('Not on this waitlist');
  await publishTripUpdate(tripId);
  return { left: true };
}

/**
 * Inside the caller's transaction: hand one freed seat to the FIFO head.
 * Promotions during/after the confirm phase land as 'confirmed' directly.
 */
async function promoteNext(client, tripId) {
  const { rows: next } = await client.query(
    `SELECT w.id, w.user_id, u.email, u.name
       FROM bus_waitlist w JOIN users u ON u.id = w.user_id
      WHERE w.trip_id = $1 AND w.promoted_at IS NULL
      ORDER BY w.joined_at ASC
      LIMIT 1
      FOR UPDATE OF w SKIP LOCKED`,
    [tripId],
  );
  if (!next.length) return null;
  const head = next[0];

  const { rowCount: claimed } = await client.query(
    'UPDATE bus_trips SET booked_count = booked_count + 1 WHERE id = $1 AND booked_count < capacity',
    [tripId],
  );
  if (!claimed) return null;

  const { rows: trips } = await client.query(
    'SELECT departure_at, bus_no, origin, destination FROM bus_trips t JOIN bus_schedules s ON s.id = t.schedule_id WHERE t.id = $1',
    [tripId],
  );
  const { confirmAt } = tripTimes(trips[0].departure_at);
  const status = Date.now() >= confirmAt.getTime() ? 'confirmed' : 'assigned';
  const confirmedAt = status === 'confirmed' ? new Date() : null;

  await client.query(
    `INSERT INTO bus_bookings (trip_id, user_id, status, confirmed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (trip_id, user_id) DO UPDATE
       SET status = EXCLUDED.status, created_at = NOW(), confirmed_at = EXCLUDED.confirmed_at`,
    [tripId, head.user_id, status, confirmedAt],
  );
  await client.query('UPDATE bus_waitlist SET promoted_at = NOW() WHERE id = $1', [head.id]);
  return { userId: head.user_id, email: head.email, name: head.name, status, trip: trips[0] };
}

async function notifyPromotions(tripId, promotions) {
  for (const p of promotions) {
    publishWaitlistNotify({ eventId: tripId, userId: p.userId, seatId: null }).catch(() => {});
    enqueueEmail({
      to: p.email,
      type: 'waitlist',
      userName: p.name,
      eventName: tripLabel({ ...p.trip, departure_at: p.trip.departure_at }),
      venue: '',
    }).catch((err) => logger.warn('[bus] promotion email failed:', err.message));
  }
}

// ── reads ──
export async function getSchedule(dateStr, userId = null) {
  const { rows } = await readPool.query(
    `SELECT t.id, t.service_date, t.departure_at, t.capacity, t.booked_count, t.status,
            s.bus_no, s.origin, s.destination,
            (SELECT COUNT(*)::int FROM bus_waitlist w WHERE w.trip_id = t.id AND w.promoted_at IS NULL) AS waitlist_count,
            mb.status AS my_status,
            (SELECT COUNT(*)::int FROM bus_waitlist w2
              WHERE w2.trip_id = t.id AND w2.promoted_at IS NULL
                AND w2.joined_at <= (SELECT joined_at FROM bus_waitlist w3 WHERE w3.trip_id = t.id AND w3.user_id = $2 AND w3.promoted_at IS NULL)
            ) AS my_waitlist_position
       FROM bus_trips t
       JOIN bus_schedules s ON s.id = t.schedule_id
       LEFT JOIN bus_bookings mb ON mb.trip_id = t.id AND mb.user_id = $2
      WHERE t.service_date = $1
      ORDER BY t.departure_at ASC, s.bus_no ASC`,
    [dateStr, userId],
  );
  return rows.map((t) => ({
    id: t.id,
    busNo: t.bus_no,
    origin: t.origin,
    destination: t.destination,
    departureAt: t.departure_at,
    status: t.status,
    booked: t.booked_count,
    capacity: t.capacity,
    waitlistCount: t.waitlist_count,
    myStatus: t.my_status || null,
    myWaitlistPosition: t.my_waitlist_position || null,
    times: tripTimes(t.departure_at),
  }));
}

export async function getTripDetail(tripId, userId = null) {
  const { rows } = await readPool.query(
    `SELECT t.*, s.bus_no, s.origin, s.destination
       FROM bus_trips t JOIN bus_schedules s ON s.id = t.schedule_id
      WHERE t.id = $1`,
    [tripId],
  );
  if (!rows.length) throw Errors.notFound('Trip not found');
  const t = rows[0];

  // The waitlist is public by design: name + roll + position.
  const { rows: waitlist } = await readPool.query(
    `SELECT u.name, u.roll_number, w.user_id, w.joined_at
       FROM bus_waitlist w JOIN users u ON u.id = w.user_id
      WHERE w.trip_id = $1 AND w.promoted_at IS NULL
      ORDER BY w.joined_at ASC`,
    [tripId],
  );

  let myBooking = null;
  if (userId) {
    const { rows: mine } = await readPool.query(
      'SELECT status, confirmed_at FROM bus_bookings WHERE trip_id = $1 AND user_id = $2',
      [tripId, userId],
    );
    myBooking = mine[0] || null;
  }

  return {
    id: t.id,
    busNo: t.bus_no,
    origin: t.origin,
    destination: t.destination,
    serviceDate: t.service_date,
    departureAt: t.departure_at,
    status: t.status,
    booked: t.booked_count,
    capacity: t.capacity,
    times: tripTimes(t.departure_at),
    waitlist: waitlist.map((w, i) => ({
      position: i + 1,
      name: w.name,
      rollNumber: w.roll_number,
      isMe: userId ? w.user_id === userId : false,
    })),
    myBooking,
  };
}

export async function getMyBusTrips(userId) {
  const { rows } = await readPool.query(
    `SELECT t.id AS trip_id, t.departure_at, t.status AS trip_status, t.booked_count, t.capacity,
            s.bus_no, s.origin, s.destination,
            b.status AS booking_status, b.confirmed_at,
            w.joined_at AS waitlist_joined
       FROM bus_trips t
       JOIN bus_schedules s ON s.id = t.schedule_id
       LEFT JOIN bus_bookings b ON b.trip_id = t.id AND b.user_id = $1
       LEFT JOIN bus_waitlist w ON w.trip_id = t.id AND w.user_id = $1 AND w.promoted_at IS NULL
      WHERE b.id IS NOT NULL OR w.id IS NOT NULL
      ORDER BY t.departure_at DESC
      LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    tripId: r.trip_id,
    busNo: r.bus_no,
    origin: r.origin,
    destination: r.destination,
    departureAt: r.departure_at,
    tripStatus: r.trip_status,
    bookingStatus: r.booking_status,
    waitlisted: Boolean(r.waitlist_joined),
    times: tripTimes(r.departure_at),
  }));
}
