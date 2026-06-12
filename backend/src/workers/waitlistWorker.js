// Notifies the next waitlisted user that a seat opened up: records it, pings the
// node instances over pub/sub (for a live toast), and queues an email.
import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis.js';
import { writePool } from '../config/db.js';
import { QUEUE_NAMES, enqueueEmail } from '../config/queues.js';
import { publishWaitlistNotify } from '../services/cacheService.js';
import { logger } from '../utils/logger.js';
import { waitlistPromotions } from '../config/metrics.js';

export async function processWaitlistNotify(job) {
  const { eventId, userId, seatId } = job.data;

  await writePool.query(
    'UPDATE waitlist SET notified_at = NOW() WHERE event_id = $1 AND user_id = $2',
    [eventId, userId],
  );

  // Live notify (a node instance subscribed to this channel emits to the user).
  await publishWaitlistNotify({ eventId, userId, seatId });

  // Also email them.
  const { rows } = await writePool.query(
    `SELECT u.email, u.name AS user_name, e.name AS event_name, e.venue
       FROM users u JOIN events e ON e.id = $2
      WHERE u.id = $1`,
    [userId, eventId],
  );
  if (rows.length) {
    await enqueueEmail({
      to: rows[0].email,
      type: 'waitlist',
      userName: rows[0].user_name,
      eventName: rows[0].event_name,
      venue: rows[0].venue,
    });
  }

  waitlistPromotions.inc({ vertical: 'events' });
  logger.info(`[waitlist] notified user=${userId} event=${eventId} seat=${seatId}`);
  return { notified: userId };
}

export function startWaitlistWorker() {
  const worker = new Worker(QUEUE_NAMES.waitlist, processWaitlistNotify, {
    connection: bullConnection,
    concurrency: 5,
  });
  worker.on('failed', (job, err) => logger.error(`[waitlist] job ${job?.id} failed:`, err.message));
  return worker;
}
