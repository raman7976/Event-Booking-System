import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { hold, release } from '../controllers/seatController.js';

const router = Router();
const idParam = z.object({ id: z.string().uuid() });
const holdSchema = z.object({ eventId: z.string().uuid() });
const releaseSchema = z.object({ holdToken: z.string().min(1) });

router.post('/:id/hold', requireAuth, validate(idParam, 'params'), validate(holdSchema), hold);
router.delete('/:id/hold', requireAuth, validate(idParam, 'params'), validate(releaseSchema), release);

// POST /api/seats/recommend (AI Smart Seat Recommender) is added in the AI section.

export default router;
