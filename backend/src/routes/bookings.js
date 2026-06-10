import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { confirm, getMine } from '../controllers/bookingController.js';

const router = Router();
const confirmSchema = z.object({
  holdToken: z.string().min(1),
  paymentMethod: z.string().min(1).default('card'),
});

router.post('/confirm', requireAuth, validate(confirmSchema), confirm);
router.get('/mine', requireAuth, getMine);

export default router;
