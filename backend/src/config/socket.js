// Socket.io server (path: /ws) with the official Redis adapter: rooms are
// cluster-wide, so an emit from any process (via lib/emitter.js) reaches every
// member exactly once, on whichever node their socket lives. No sticky
// load-balancing needed — clients connect websocket-only (no polling handshake).
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { publisher, subscriber } from './redis.js';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/ws',
    cors: { origin: config.clientUrls, credentials: true },
    adapter: createAdapter(publisher, subscriber),
  });

  io.on('connection', (socket) => {
    logger.debug(`[ws] connect ${socket.id} on ${config.instanceId}`);
    // Tell the client which node it landed on (useful for debugging LB).
    socket.emit('connected', { instance: config.instanceId, socketId: socket.id });

    socket.on('join-event', (eventId) => {
      if (!eventId) return;
      socket.join(`event:${eventId}`);
      logger.debug(`[ws] ${socket.id} joined event:${eventId}`);
    });
    socket.on('leave-event', (eventId) => {
      if (eventId) socket.leave(`event:${eventId}`);
    });

    // Bus vertical rooms: one per trip + a broadcast room for the schedule page.
    socket.on('join-trip', (tripId) => {
      if (tripId) socket.join(`trip:${tripId}`);
    });
    socket.on('leave-trip', (tripId) => {
      if (tripId) socket.leave(`trip:${tripId}`);
    });
    socket.on('join-bus-schedule', () => socket.join('bus:schedule'));
    socket.on('leave-bus-schedule', () => socket.leave('bus:schedule'));

    // Personal room for targeted notifications (e.g. waitlist seat available).
    // The client sends its access token; we verify it server-side rather than
    // trusting a client-supplied user id.
    socket.on('identify', (accessToken) => {
      try {
        const p = jwt.verify(accessToken, config.jwt.secret);
        if (p.type === 'refresh') return; // wrong token kind
        socket.join(`user:${p.sub}`);
        logger.debug(`[ws] ${socket.id} identified as user:${p.sub}`);
      } catch {
        logger.debug(`[ws] ${socket.id} identify rejected (bad token)`);
      }
    });

    socket.on('disconnect', () => logger.debug(`[ws] disconnect ${socket.id}`));
  });

  logger.info(`[ws] redis adapter active on ${config.instanceId}`);
  return io;
}
