// HTTP + (later) WebSocket entrypoint. Routes are mounted in a later section;
// the Socket.io server is attached in the real-time section.
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { isRedisReady } from './config/redis.js';
import { writePool } from './config/db.js';

const app = express();
app.set('trust proxy', true); // honor X-Forwarded-* from nginx
app.use(cors({ origin: config.clientUrls, credentials: true }));
app.use(express.json());

// Liveness/readiness probe (used by docker + nginx healthchecks)
app.get('/health', async (_req, res) => {
  let db = 'down';
  try {
    await writePool.query('SELECT 1');
    db = 'ok';
  } catch {
    db = 'down';
  }
  res.json({
    status: 'ok',
    instance: config.instanceId,
    db,
    redis: isRedisReady() ? 'ready' : 'down',
    uptime: Math.round(process.uptime()),
  });
});

// API routes are mounted here in a later section:
//   app.use('/api', apiRouter);
// (and the global errorHandler is added after them)

const server = http.createServer(app);
server.listen(config.port, () => {
  logger.info(`[server] ${config.instanceId} listening on :${config.port} (${config.env})`);
});

function shutdown(signal) {
  logger.info(`[server] ${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server };
