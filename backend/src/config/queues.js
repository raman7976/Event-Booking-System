// BullMQ queues + helpers. The worker process (src/workers) consumes these.
import { Queue } from 'bullmq';
import { bullConnection } from './redis.js';
import { logger } from '../utils/logger.js';

export const QUEUE_NAMES = {
  expiry: 'seat-expiry',
  email: 'email',
  waitlist: 'waitlist',
  bus: 'bus-lifecycle',
};

export const expiryQueue = new Queue(QUEUE_NAMES.expiry, { connection: bullConnection });
export const emailQueue = new Queue(QUEUE_NAMES.email, { connection: bullConnection });
export const waitlistQueue = new Queue(QUEUE_NAMES.waitlist, { connection: bullConnection });
export const busQueue = new Queue(QUEUE_NAMES.bus, { connection: bullConnection });

// NOTE: BullMQ custom job ids may not contain ':' — use a hyphen.
const expiryJobId = (holdToken) => `expiry-${holdToken}`;

/** Schedule the auto-release of a hold after `delayMs` (default = hold TTL). */
export async function scheduleExpiry(holdToken, payload, delayMs) {
  return expiryQueue.add('expire-hold', payload, {
    jobId: expiryJobId(holdToken),
    delay: delayMs,
    removeOnComplete: true,
    removeOnFail: 1000,
  });
}

/** Cancel a pending expiry job (called on confirm / manual release). */
export async function cancelExpiry(holdToken) {
  try {
    const job = await expiryQueue.getJob(expiryJobId(holdToken));
    if (job) {
      await job.remove();
      return true;
    }
  } catch (err) {
    logger.warn(`[queues] cancelExpiry(${holdToken}) failed: ${err.message}`);
  }
  return false;
}

export async function enqueueEmail(payload) {
  return emailQueue.add('send-confirmation', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 1000,
  });
}

export async function enqueueWaitlistNotify(payload) {
  return waitlistQueue.add('notify-next', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 1000,
  });
}

/**
 * Bus lifecycle job with a stable id (idempotent re-scheduling: BullMQ ignores
 * an add when a job with the same id already exists).
 */
export async function scheduleBusJob(name, payload, delayMs, jobId) {
  return busQueue.add(name, payload, {
    jobId,
    delay: Math.max(0, delayMs),
    removeOnComplete: true,
    removeOnFail: 500,
  });
}

/** Daily trip generation at 00:05 server time (worker also runs one on boot). */
export async function ensureDailyBusGeneration() {
  return busQueue.add(
    'generate-trips',
    {},
    {
      repeat: { pattern: '5 0 * * *' },
      jobId: 'generate-trips-daily',
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

export async function closeQueues() {
  await Promise.allSettled([
    expiryQueue.close(),
    emailQueue.close(),
    waitlistQueue.close(),
    busQueue.close(),
  ]);
}
