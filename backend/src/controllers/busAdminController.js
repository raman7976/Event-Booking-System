// Transport-admin operations: timetable CRUD, holidays, manifests, regeneration.
import { writePool, readPool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Errors } from '../utils/errors.js';
import { generateTripsForDate } from '../services/busService.js';

export const listSchedules = asyncHandler(async (_req, res) => {
  const { rows } = await readPool.query(
    `SELECT id, bus_no, origin, destination, departure_time, pattern, weekday_only, capacity, active
       FROM bus_schedules
      ORDER BY pattern, departure_time, bus_no`,
  );
  res.json({ schedules: rows });
});

export const createSchedule = asyncHandler(async (req, res) => {
  const { busNo, origin, destination, departureTime, pattern, weekdayOnly, capacity } = req.body;
  const { rows } = await writePool.query(
    `INSERT INTO bus_schedules (bus_no, origin, destination, departure_time, pattern, weekday_only, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [busNo, origin, destination, departureTime, pattern, weekdayOnly ?? null, capacity],
  );
  res.status(201).json({ schedule: rows[0] });
});

export const updateSchedule = asyncHandler(async (req, res) => {
  const { capacity, active } = req.body;
  const { rows } = await writePool.query(
    `UPDATE bus_schedules
        SET capacity = COALESCE($2, capacity),
            active = COALESCE($3, active)
      WHERE id = $1
      RETURNING *`,
    [req.params.id, capacity ?? null, active ?? null],
  );
  if (!rows.length) throw Errors.notFound('Schedule not found');
  res.json({ schedule: rows[0] });
});

export const deleteSchedule = asyncHandler(async (req, res) => {
  const { rows: used } = await writePool.query(
    'SELECT 1 FROM bus_trips WHERE schedule_id = $1 LIMIT 1',
    [req.params.id],
  );
  if (used.length) {
    throw Errors.conflict('Trips exist for this schedule — deactivate it instead of deleting');
  }
  const { rowCount } = await writePool.query('DELETE FROM bus_schedules WHERE id = $1', [req.params.id]);
  if (!rowCount) throw Errors.notFound('Schedule not found');
  res.json({ deleted: true });
});

export const listHolidays = asyncHandler(async (_req, res) => {
  const { rows } = await readPool.query('SELECT day, label FROM holidays ORDER BY day');
  res.json({ holidays: rows });
});

export const addHoliday = asyncHandler(async (req, res) => {
  const { day, label } = req.body;
  await writePool.query(
    'INSERT INTO holidays (day, label) VALUES ($1, $2) ON CONFLICT (day) DO UPDATE SET label = EXCLUDED.label',
    [day, label || null],
  );
  res.status(201).json({ day, label: label || null });
});

export const removeHoliday = asyncHandler(async (req, res) => {
  const { rowCount } = await writePool.query('DELETE FROM holidays WHERE day = $1', [req.params.day]);
  if (!rowCount) throw Errors.notFound('Holiday not found');
  res.json({ deleted: true });
});

/** Who is on this bus: every booking row with rider identity, plus the waitlist. */
export const tripManifest = asyncHandler(async (req, res) => {
  const { rows: trip } = await readPool.query(
    `SELECT t.id, t.departure_at, t.status, t.booked_count, t.capacity, s.bus_no, s.origin, s.destination
       FROM bus_trips t JOIN bus_schedules s ON s.id = t.schedule_id WHERE t.id = $1`,
    [req.params.id],
  );
  if (!trip.length) throw Errors.notFound('Trip not found');

  const { rows: riders } = await readPool.query(
    `SELECT u.name, u.roll_number, u.email, b.status, b.confirmed_at, b.created_at
       FROM bus_bookings b JOIN users u ON u.id = b.user_id
      WHERE b.trip_id = $1
      ORDER BY b.created_at`,
    [req.params.id],
  );
  const { rows: waiting } = await readPool.query(
    `SELECT u.name, u.roll_number FROM bus_waitlist w JOIN users u ON u.id = w.user_id
      WHERE w.trip_id = $1 AND w.promoted_at IS NULL ORDER BY w.joined_at`,
    [req.params.id],
  );
  res.json({ trip: trip[0], riders, waiting });
});

export const regenerate = asyncHandler(async (req, res) => {
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  const created = await generateTripsForDate(date);
  res.json({ date, created });
});
