// Bookings: confirm a held seat (the critical transaction) and list my bookings.
import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError, Errors } from '../utils/errors.js';
import { writePool, withTransaction } from '../config/db.js';
import { redis, isRedisReady } from '../config/redis.js';
import { cancelExpiry, enqueueEmail } from '../config/queues.js';
import { publishSeatUpdate, markUserWrite } from '../services/cacheService.js';
import { logger } from '../utils/logger.js';

export const confirm = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { holdToken, paymentMethod } = req.body;

  // Load the hold with seat + event details.
  const { rows } = await writePool.query(
    `SELECT r.id, r.seat_id, r.event_id, r.user_id, r.status,
            s.price AS seat_price, s.row_label, s.seat_number, s.category,
            e.name AS event_name, e.venue, e.event_date
       FROM reservations r
       JOIN seats s  ON s.id = r.seat_id
       JOIN events e ON e.id = r.event_id
      WHERE r.hold_token = $1`,
    [holdToken],
  );
  if (!rows.length) throw Errors.notFound('Hold not found');
  const r = rows[0];
  if (r.user_id !== userId) throw Errors.forbidden('Not your hold');
  if (r.status === 'confirmed') throw Errors.conflict('Booking already confirmed');
  if (r.status !== 'held') throw Errors.conflict('Hold expired or cancelled');

  // Validate the Redis hold token still belongs to this user (best-effort).
  if (isRedisReady()) {
    try {
      const val = await redis.get(`seat:${r.event_id}:${r.seat_id}`);
      if (val && val !== `${userId}:${holdToken}`) throw Errors.conflict('Hold no longer valid');
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn('[confirm] redis check failed:', err.message);
    }
  }

  const transactionId = `txn_${crypto.randomUUID()}`;
  const amount = Number(r.seat_price) || 0;

  const payment = await withTransaction(async (client) => {
    const upd = await client.query(
      "UPDATE reservations SET status = 'confirmed', confirmed_at = NOW() WHERE id = $1 AND status = 'held' RETURNING id",
      [r.id],
    );
    if (upd.rowCount === 0) throw Errors.conflict('Hold expired or cancelled');

    await client.query("UPDATE seats SET status = 'booked', version = version + 1 WHERE id = $1", [r.seat_id]);

    const pay = await client.query(
      `INSERT INTO payments (reservation_id, user_id, amount, status, payment_method, transaction_id)
       VALUES ($1, $2, $3, 'completed', $4, $5)
       RETURNING id, amount, status, payment_method, transaction_id, created_at`,
      [r.id, userId, amount, paymentMethod, transactionId],
    );

    await client.query(
      'UPDATE events SET available_seats = GREATEST(available_seats - 1, 0) WHERE id = $1',
      [r.event_id],
    );
    return pay.rows[0];
  });

  // Side effects (best-effort; the booking is already durable).
  if (isRedisReady()) {
    try {
      await redis.del(`seat:${r.event_id}:${r.seat_id}`);
    } catch (err) {
      logger.warn('[confirm] redis del failed:', err.message);
    }
  }
  await cancelExpiry(holdToken);
  await enqueueEmail({
    to: req.user.email,
    type: 'confirmation',
    userName: req.user.name,
    eventName: r.event_name,
    venue: r.venue,
    seats: [{ row: r.row_label, number: r.seat_number, category: r.category, price: amount }],
    total: amount,
    transactionId,
  }).catch((err) => logger.warn('[confirm] email enqueue failed:', err.message));
  await publishSeatUpdate({ eventId: r.event_id, seatId: r.seat_id, status: 'booked' });
  markUserWrite(userId).catch(() => {});

  res.status(201).json({
    booking: {
      reservationId: r.id,
      status: 'confirmed',
      seat: { id: r.seat_id, row: r.row_label, number: r.seat_number, category: r.category, price: amount },
      event: { id: r.event_id, name: r.event_name, venue: r.venue, date: r.event_date },
      payment: {
        id: payment.id,
        amount: Number(payment.amount),
        status: payment.status,
        method: payment.payment_method,
        transactionId: payment.transaction_id,
        createdAt: payment.created_at,
      },
    },
  });
});

export const getMine = asyncHandler(async (req, res) => {
  const { rows } = await writePool.query(
    `SELECT r.id AS reservation_id, r.status, r.held_at, r.expires_at, r.confirmed_at,
            s.id AS seat_id, s.row_label, s.seat_number, s.category, s.price,
            e.id AS event_id, e.name AS event_name, e.venue, e.event_date,
            p.amount, p.transaction_id, p.status AS payment_status
       FROM reservations r
       JOIN seats s  ON s.id = r.seat_id
       JOIN events e ON e.id = r.event_id
       LEFT JOIN payments p ON p.reservation_id = r.id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC`,
    [req.user.id],
  );

  res.json({
    bookings: rows.map((r) => ({
      reservationId: r.reservation_id,
      status: r.status,
      seat: { id: r.seat_id, row: r.row_label, number: r.seat_number, category: r.category, price: Number(r.price) },
      event: { id: r.event_id, name: r.event_name, venue: r.venue, date: r.event_date },
      heldAt: r.held_at,
      expiresAt: r.expires_at,
      confirmedAt: r.confirmed_at,
      payment: r.amount != null ? { amount: Number(r.amount), transactionId: r.transaction_id, status: r.payment_status } : null,
    })),
  });
});
