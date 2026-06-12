// HTTP + (later) WebSocket entrypoint. Routes are mounted in a later section;
// the Socket.io server is attached in the real-time section.
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import http from 'node:http';
import { httpMetrics, metricsHandler } from './config/metrics.js';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { isRedisReady } from './config/redis.js';
import { writePool } from './config/db.js';
import apiRouter from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { initSocket } from './config/socket.js';

const app = express();
app.set('trust proxy', true); // honor X-Forwarded-* from nginx
app.use(cors({ origin: config.clientUrls, credentials: true }));
app.use(express.json());
app.use(cookieParser()); // refresh-token cookie on /api/auth/*
// Surface which instance served the request (handy for verifying load balancing)
// + a request id for log correlation across services.
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  res.setHeader('X-Served-By', config.instanceId);
  next();
});
app.use(httpMetrics);

// Prometheus scrape endpoint (reached over the docker network).
app.get('/metrics', metricsHandler);

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

app.use('/api', apiRouter);

// 404 + central error handling (Section 11) — must be registered last.
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
const io = initSocket(server);

server.listen(config.port, () => {
  logger.info(`[server] ${config.instanceId} listening on :${config.port} (${config.env})`);
});

function shutdown(signal) {
  logger.info(`[server] ${signal} received — shutting down`);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server };
