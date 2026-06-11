// Admin-only operations: event lifecycle management + booking oversight.
import { writePool, readPool, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Create an event with its full seat map in one transaction.
 * layout: [{ rows: ['A','B'], cols: 10, category: 'VIP', price: 250 }, ...]
 */
export const createEvent = asyncHandler(async (req, res) => {
  const { name, venue, eventDate, layout } = req.body;

  const totalSeats = layout.reduce((acc, s) => acc + s.rows.length * s.cols, 0);
  const basePrice = Math.min(...layout.map((s) => s.price));

  // Duplicate row labels across sections would violate UNIQUE(event_id,row,seat).
  const allRows = layout.flatMap((s) => s.rows);
  if (new Set(allRows).size !== allRows.length) {
    throw Errors.validation('Row labels must be unique across sections');
  }

  const event = await withTransaction(async (client) => {
    const { rows: [ev] } = await client.query(
      `INSERT INTO events (name, venue, event_date, total_seats, available_seats, base_price)
       VALUES ($1, $2, $3, $4, $4, $5)
       RETURNING *`,
      [name, venue, eventDate, totalSeats, basePrice],
    );
    for (const section of layout) {
      for (const row of section.rows) {
        for (let n = 1; n <= section.cols; n += 1) {
          await client.query(
            `INSERT INTO seats (event_id, row_label, seat_number, category, price, status)
             VALUES ($1, $2, $3, $4, $5, 'available')`,
            [ev.id, row, n, section.category, section.price],
          );
        }
      }
    }
    return ev;
  });

  logger.info(`[admin] ${req.user.email} created event ${event.id} (${totalSeats} seats)`);
  res.status(201).json({ event });
});

/** Delete an event — refused while it has confirmed bookings. */
export const deleteEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: ev } = await writePool.query('SELECT id FROM events WHERE id = $1', [id]);
  if (!ev.length) throw Errors.notFound('Event not found');

  const confirmed = await writePool.query(
    "SELECT 1 FROM reservations WHERE event_id = $1 AND status = 'confirmed' LIMIT 1",
    [id],
  );
  if (confirmed.rowCount) {
    throw Errors.conflict('Event has confirmed bookings — cancel them before deleting');
  }

  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM payments WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)',
      [id],
    );
    await client.query('DELETE FROM reservations WHERE event_id = $1', [id]);
    await client.query('DELETE FROM waitlist WHERE event_id = $1', [id]);
    await client.query('DELETE FROM seats WHERE event_id = $1', [id]);
    await client.query('DELETE FROM events WHERE id = $1', [id]);
  });

  logger.info(`[admin] ${req.user.email} deleted event ${id}`);
  res.json({ deleted: true });
});

/** Every reservation for an event, with who booked it and what they paid. */
export const getEventBookings = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await writePool.query(
    `SELECT r.id, r.status, r.held_at, r.expires_at, r.confirmed_at,
            u.email, u.name AS user_name,
            s.row_label, s.seat_number, s.category, s.price,
            p.amount, p.transaction_id
       FROM reservations r
       JOIN users u ON u.id = r.user_id
       JOIN seats s ON s.id = r.seat_id
       LEFT JOIN payments p ON p.reservation_id = r.id
      WHERE r.event_id = $1
      ORDER BY r.created_at DESC`,
    [id],
  );
  res.json({
    bookings: rows.map((r) => ({
      id: r.id,
      status: r.status,
      user: { email: r.email, name: r.user_name },
      seat: { row: r.row_label, number: r.seat_number, category: r.category, price: Number(r.price) },
      heldAt: r.held_at,
      expiresAt: r.expires_at,
      confirmedAt: r.confirmed_at,
      payment: r.amount != null ? { amount: Number(r.amount), transactionId: r.transaction_id } : null,
    })),
  });
});

/** Cross-event totals for the admin landing page. */
export const getOverview = asyncHandler(async (_req, res) => {
  const [{ rows: ev }, { rows: bk }, { rows: us }] = await Promise.all([
    readPool.query('SELECT COUNT(*)::int AS events, COALESCE(SUM(total_seats),0)::int AS seats, COALESCE(SUM(total_seats - available_seats),0)::int AS sold FROM events'),
    readPool.query("SELECT COUNT(*)::int AS confirmed, COALESCE(SUM(p.amount),0) AS revenue FROM reservations r LEFT JOIN payments p ON p.reservation_id = r.id WHERE r.status = 'confirmed'"),
    readPool.query('SELECT COUNT(*)::int AS users FROM users'),
  ]);
  res.json({
    events: ev[0].events,
    totalSeats: ev[0].seats,
    seatsSold: ev[0].sold,
    confirmedBookings: bk[0].confirmed,
    revenue: Number(bk[0].revenue),
    users: us[0].users,
  });
});
