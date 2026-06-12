// Prometheus metrics (prom-client). One registry per process; api nodes serve
// it at GET /metrics, the worker on its health server. Route labels normalize
// UUIDs to ':id' to keep cardinality bounded.
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by method/route/status',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const seatHolds = new client.Counter({
  name: 'seat_holds_total',
  help: 'Successful seat holds (events vertical)',
  labelNames: ['path'], // redis | pg_fallback
  registers: [registry],
});

export const seatConfirms = new client.Counter({
  name: 'seat_confirms_total',
  help: 'Confirmed (paid) event bookings',
  registers: [registry],
});

export const busActions = new client.Counter({
  name: 'bus_bookings_total',
  help: 'Bus booking actions',
  labelNames: ['action'], // book | cancel | decline | confirm
  registers: [registry],
});

export const waitlistPromotions = new client.Counter({
  name: 'waitlist_promotions_total',
  help: 'Waitlist promotions delivered',
  labelNames: ['vertical'], // events | bus
  registers: [registry],
});

export const socketsConnected = new client.Gauge({
  name: 'socketio_connected',
  help: 'Currently connected Socket.IO clients on this instance',
  registers: [registry],
});

export const queueJobs = new client.Gauge({
  name: 'bullmq_jobs',
  help: 'BullMQ job counts by queue and state',
  labelNames: ['queue', 'state'],
  registers: [registry],
});

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Express middleware: request duration histogram with normalized routes. */
export function httpMetrics(req, res, next) {
  const endTimer = httpDuration.startTimer({ method: req.method });
  res.on('finish', () => {
    const route = (req.baseUrl + (req.route?.path || req.path)).replace(UUID_RE, ':id');
    endTimer({ route, status: res.statusCode });
  });
  next();
}

export async function metricsHandler(_req, res) {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
