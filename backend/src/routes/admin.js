// Admin API — every route requires a valid access token with role 'admin'.
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createEvent, deleteEvent, getEventBookings, getOverview } from '../controllers/adminController.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const idParam = z.object({ id: z.string().uuid() });

const sectionSchema = z.object({
  // accept "A,B,C" or ["A","B","C"]; normalize to an array of short labels
  rows: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((r) => r.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.string().min(1).max(5)).min(1)),
  cols: z.coerce.number().int().min(1).max(50),
  category: z.enum(['VIP', 'PREMIUM', 'GENERAL']),
  price: z.coerce.number().positive(),
});

const createEventSchema = z.object({
  name: z.string().min(1).max(255),
  venue: z.string().min(1).max(255),
  eventDate: z.coerce.date().refine((d) => d.getTime() > Date.now(), 'eventDate must be in the future'),
  layout: z.array(sectionSchema).min(1).max(10),
});

router.get('/overview', getOverview);
router.post('/events', validate(createEventSchema), createEvent);
router.delete('/events/:id', validate(idParam, 'params'), deleteEvent);
router.get('/events/:id/bookings', validate(idParam, 'params'), getEventBookings);

export default router;
