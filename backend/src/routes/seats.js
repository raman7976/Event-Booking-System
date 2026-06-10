import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { hold, release, recommend } from '../controllers/seatController.js';

const router = Router();
const idParam = z.object({ id: z.string().uuid() });
const holdSchema = z.object({ eventId: z.string().uuid() });
const releaseSchema = z.object({ holdToken: z.string().min(1) });
const recommendSchema = z.object({
  eventId: z.string().uuid(),
  groupSize: z.coerce.number().int().min(1).max(20).default(1),
  maxBudget: z.coerce.number().positive().optional(),
  preferences: z.union([z.string(), z.array(z.string())]).optional(),
});

// AI Smart Seat Recommender (public — used before/while choosing seats)
router.post('/recommend', validate(recommendSchema), recommend);

router.post('/:id/hold', requireAuth, validate(idParam, 'params'), validate(holdSchema), hold);
router.delete('/:id/hold', requireAuth, validate(idParam, 'params'), validate(releaseSchema), release);

export default router;
