// Events: list (paginated), single event + seat summary, and dashboard stats.
import { readPool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Errors } from '../utils/errors.js';

export const listEvents = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  const [{ rows }, { rows: cnt }] = await Promise.all([
    readPool.query(
      `SELECT id, name, venue, event_date, total_seats, available_seats, base_price, created_at
         FROM events ORDER BY event_date ASC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    readPool.query('SELECT COUNT(*)::int AS total FROM events'),
  ]);

  res.json({
    events: rows,
    pagination: { page, limit, total: cnt[0].total, pages: Math.ceil(cnt[0].total / limit) },
  });
});

export const getEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await readPool.query('SELECT * FROM events WHERE id = $1', [id]);
  if (!rows.length) throw Errors.notFound('Event not found');

  const { rows: agg } = await readPool.query(
    `SELECT category, status, COUNT(*)::int AS count, MIN(price) AS min_price, MAX(price) AS max_price
       FROM seats WHERE event_id = $1 GROUP BY category, status`,
    [id],
  );

  const byStatus = {};
  const byCategory = {};
  for (const a of agg) {
    byStatus[a.status] = (byStatus[a.status] || 0) + a.count;
    const c = (byCategory[a.category] ||= { count: 0, minPrice: Infinity, maxPrice: -Infinity });
    c.count += a.count;
    c.minPrice = Math.min(c.minPrice, Number(a.min_price));
    c.maxPrice = Math.max(c.maxPrice, Number(a.max_price));
  }

  res.json({ event: rows[0], summary: { byStatus, byCategory } });
});

export const getEventStats = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: ev } = await readPool.query(
    'SELECT id, name, total_seats, available_seats FROM events WHERE id = $1',
    [id],
  );
  if (!ev.length) throw Errors.notFound('Event not found');

  const [byStatus, byCategory, timeline] = await Promise.all([
    readPool.query('SELECT status, COUNT(*)::int AS count FROM seats WHERE event_id = $1 GROUP BY status', [id]),
    readPool.query(
      `SELECT category,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'booked')::int AS booked,
              COALESCE(SUM(price) FILTER (WHERE status = 'booked'), 0) AS revenue
         FROM seats WHERE event_id = $1 GROUP BY category ORDER BY category`,
      [id],
    ),
    readPool.query(
      `SELECT date_trunc('minute', confirmed_at) AS bucket, COUNT(*)::int AS count
         FROM reservations
        WHERE event_id = $1 AND status = 'confirmed' AND confirmed_at IS NOT NULL
        GROUP BY bucket ORDER BY bucket`,
      [id],
    ),
  ]);

  const revenueByCategory = byCategory.rows.map((r) => ({
    category: r.category,
    total: r.total,
    booked: r.booked,
    revenue: Number(r.revenue),
  }));
  const totalRevenue = revenueByCategory.reduce((acc, c) => acc + c.revenue, 0);
  const occupancy = ev[0].total_seats
    ? Math.round((1 - ev[0].available_seats / ev[0].total_seats) * 100)
    : 0;

  res.json({
    event: ev[0],
    seatsByStatus: byStatus.rows.map((r) => ({ status: r.status, count: r.count })),
    revenueByCategory,
    bookingsTimeline: timeline.rows.map((r) => ({ time: r.bucket, count: r.count })),
    totalRevenue,
    occupancy,
  });
});
