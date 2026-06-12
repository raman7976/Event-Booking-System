// Cluster-wide Socket.IO emits from ANY process (api nodes + the BullMQ worker)
// via @socket.io/redis-emitter. Messages travel through the redis-adapter, so
// each event is delivered exactly once to every member of a room regardless of
// which node holds the socket — replacing the old hand-rolled channel bridge
// where every node re-emitted every message.
import { Emitter } from '@socket.io/redis-emitter';
import { publisher, isRedisReady } from '../config/redis.js';
import { logger } from '../utils/logger.js';

let emitter = null;
function getEmitter() {
  if (!emitter) emitter = new Emitter(publisher);
  return emitter;
}

function safeEmit(fn) {
  if (!isRedisReady()) {
    logger.warn('[emitter] redis down — realtime emit skipped');
    return;
  }
  try {
    fn(getEmitter());
  } catch (err) {
    logger.warn('[emitter] emit failed:', err.message);
  }
}

/** Events vertical: live seat status to everyone viewing the event. */
export function emitSeatUpdate(eventId, { seatId, status, timestamp }) {
  safeEmit((e) => e.to(`event:${eventId}`).emit('seat-update', { seatId, status, timestamp }));
}

/** Bus vertical: counts/status to the trip room + the schedule overview room. */
export function emitTripUpdate(payload) {
  safeEmit((e) => e.to(`trip:${payload.tripId}`).to('bus:schedule').emit('trip-update', payload));
}

/** Targeted notification (waitlist promotion) to one user's personal room. */
export function emitWaitlistNotify(userId, payload) {
  safeEmit((e) => e.to(`user:${userId}`).emit('waitlist-available', payload));
}
