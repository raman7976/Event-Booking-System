// Socket.io server (path: /ws). Each node instance subscribes to the Redis
// "seat-updates" / "waitlist-notify" channels and fans messages out to its local
// rooms — so a change made on ANY node reaches every connected client.
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { subscriber } from './redis.js';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
import { SEAT_UPDATES_CHANNEL, WAITLIST_NOTIFY_CHANNEL } from '../services/cacheService.js';

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/ws',
    cors: { origin: config.clientUrls, credentials: true },
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

  // ── Redis pub/sub -> local Socket.io rooms ──
  subscriber.subscribe(SEAT_UPDATES_CHANNEL, WAITLIST_NOTIFY_CHANNEL, (err, count) => {
    if (err) logger.error('[ws] subscribe failed:', err.message);
    else logger.info(`[ws] subscribed to ${count} channel(s) on ${config.instanceId}`);
  });

  subscriber.on('message', (channel, message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      logger.warn('[ws] bad pub/sub payload:', err.message);
      return;
    }
    if (channel === SEAT_UPDATES_CHANNEL) {
      const { eventId, seatId, status, timestamp } = data;
      io.to(`event:${eventId}`).emit('seat-update', { seatId, status, timestamp });
    } else if (channel === WAITLIST_NOTIFY_CHANNEL) {
      const { eventId, userId, seatId, timestamp } = data;
      io.to(`user:${userId}`).emit('waitlist-available', { eventId, seatId, timestamp });
    }
  });

  return io;
}
