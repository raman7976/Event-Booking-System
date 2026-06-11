// Mounts every API router under /api.
import { Router } from 'express';
import authRoutes from './auth.js';
import eventRoutes from './events.js';
import seatRoutes from './seats.js';
import bookingRoutes from './bookings.js';
import waitlistRoutes from './waitlist.js';
import adminRoutes from './admin.js';

const api = Router();

api.use('/auth', authRoutes);
api.use('/events', eventRoutes);
api.use('/seats', seatRoutes);
api.use('/bookings', bookingRoutes);
api.use('/waitlist', waitlistRoutes);
api.use('/admin', adminRoutes);

export default api;
