// Worker process entrypoint (runs in the bullmq_worker container, separate from
// the API). Boots all three processors + a tiny health server for healthchecks.
import http from 'node:http';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { isRedisReady, closeRedis } from '../config/redis.js';
import { closePools } from '../config/db.js';
import { closeQueues } from '../config/queues.js';
import { startExpiryWorker } from './expiryWorker.js';
import { startEmailWorker } from './emailWorker.js';
import { startWaitlistWorker } from './waitlistWorker.js';

const workers = [startExpiryWorker(), startEmailWorker(), startWaitlistWorker()];
logger.info(`[workers] started expiry + email + waitlist (instance ${config.instanceId})`);

const health = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        role: 'worker',
        redis: isRedisReady() ? 'ready' : 'down',
        uptime: Math.round(process.uptime()),
      }),
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});
health.listen(config.workerHealthPort, () =>
  logger.info(`[workers] health server on :${config.workerHealthPort}`),
);

async function shutdown(signal) {
  logger.info(`[workers] ${signal} received — closing workers`);
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  health.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
