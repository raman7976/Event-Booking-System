import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listEvents, getEvent, getEventStats } from '../controllers/eventController.js';
import { getSeats } from '../controllers/seatController.js';

const router = Router();
const idParam = z.object({ id: z.string().uuid() });

router.get('/', listEvents);
router.get('/:id', validate(idParam, 'params'), getEvent);
// All seats for an event (optionalAuth so we can flag "held by me")
router.get('/:id/seats', validate(idParam, 'params'), optionalAuth, getSeats);
// Analytics dashboard — admin only
router.get('/:id/stats', requireAuth, requireRole('admin'), validate(idParam, 'params'), getEventStats);

export default router;
