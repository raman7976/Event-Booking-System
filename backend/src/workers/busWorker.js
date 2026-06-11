// Bus lifecycle worker: daily trip generation + the per-trip phase jobs
// (open at T-open, confirm phase at T-confirm, unconfirmed sweep at T-release,
// close at departure). Job ids are stable, so re-scheduling is idempotent.
import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis.js';
import { QUEUE_NAMES, ensureDailyBusGeneration, busQueue } from '../config/queues.js';
import {
  generateTripsForDate, openTrip, startConfirmPhase, releaseUnconfirmed, departTrip,
} from '../services/busService.js';
import { logger } from '../utils/logger.js';

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export async function processBusJob(job) {
  switch (job.name) {
    case 'generate-trips': {
      const date = job.data.date || todayStr();
      const created = await generateTripsForDate(date);
      return { date, created };
    }
    case 'open-trip':
      return openTrip(job.data.tripId);
    case 'confirm-phase':
      return startConfirmPhase(job.data.tripId);
    case 'auto-release':
      return releaseUnconfirmed(job.data.tripId);
    case 'depart-trip':
      return departTrip(job.data.tripId);
    default:
      logger.warn(`[bus] unknown job ${job.name}`);
      return {};
  }
}

export function startBusWorker() {
  const worker = new Worker(QUEUE_NAMES.bus, processBusJob, {
    connection: bullConnection,
    concurrency: 5,
  });
  worker.on('failed', (job, err) => logger.error(`[bus] job ${job?.name}/${job?.id} failed:`, err.message));

  // Boot-time catch-up: make sure today's trips exist and the daily repeatable
  // job is registered (both idempotent).
  busQueue
    .add('generate-trips', {}, { jobId: `generate-boot-${todayStr()}`, removeOnComplete: true })
    .catch((err) => logger.warn('[bus] boot generation enqueue failed:', err.message));
  ensureDailyBusGeneration().catch((err) =>
    logger.warn('[bus] repeatable registration failed:', err.message),
  );

  return worker;
}
