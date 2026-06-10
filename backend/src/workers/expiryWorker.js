// Auto-releases a hold 480s after it was placed (BullMQ delayed job).
import { Worker } from 'bullmq';
import { bullConnection, redis, isRedisReady } from '../config/redis.js';
import { writePool, withTransaction } from '../config/db.js';
import { QUEUE_NAMES, enqueueWaitlistNotify } from '../config/queues.js';
import { publishSeatUpdate } from '../services/cacheService.js';
import { popNextWaitlisted } from '../services/waitlistService.js';
import { logger } from '../utils/logger.js';

export async function processExpiry(job) {
  const { holdToken } = job.data;

  const { rows } = await writePool.query(
    'SELECT id, seat_id, event_id, user_id, status FROM reservations WHERE hold_token = $1',
    [holdToken],
  );
  if (rows.length === 0) {
    logger.info(`[expiry] no reservation for ${holdToken} — skip`);
    return { skipped: 'no-reservation' };
  }
  const r = rows[0];
  if (r.status !== 'held') {
    logger.info(`[expiry] ${holdToken} already ${r.status} — skip`);
    return { skipped: r.status };
  }

  // Expire the reservation, free the seat, count the no-show — atomically.
  await withTransaction(async (client) => {
    await client.query("UPDATE reservations SET status = 'expired' WHERE id = $1 AND status = 'held'", [r.id]);
    await client.query(
      "UPDATE seats SET status = 'available', version = version + 1 WHERE id = $1 AND status <> 'booked'",
      [r.seat_id],
    );
    await client.query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [r.user_id]);
  });

  // Drop the Redis hold key (if still present).
  if (isRedisReady()) {
    try {
      await redis.del(`seat:${r.event_id}:${r.seat_id}`);
    } catch (err) {
      logger.warn('[expiry] redis del failed:', err.message);
    }
  }

  // Live update for everyone watching the event.
  await publishSeatUpdate({ eventId: r.event_id, seatId: r.seat_id, status: 'available' });

  // Offer the freed seat to the next person on the waitlist.
  try {
    const nextUserId = await popNextWaitlisted(r.event_id);
    if (nextUserId) {
      await enqueueWaitlistNotify({ eventId: r.event_id, userId: nextUserId, seatId: r.seat_id });
      logger.info(`[expiry] offered seat ${r.seat_id} to waitlisted user ${nextUserId}`);
    }
  } catch (err) {
    logger.warn('[expiry] waitlist handoff failed:', err.message);
  }

  logger.info(`[expiry] released seat=${r.seat_id} token=${holdToken}`);
  return { released: true, seatId: r.seat_id };
}

export function startExpiryWorker() {
  const worker = new Worker(QUEUE_NAMES.expiry, processExpiry, {
    connection: bullConnection,
    concurrency: 10,
  });
  worker.on('failed', (job, err) => logger.error(`[expiry] job ${job?.id} failed:`, err.message));
  worker.on('completed', (job) => logger.debug(`[expiry] job ${job.id} completed`));
  return worker;
}
