import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { joinWaitlist, leaveWaitlist, getWaitlistInfo } from '../services/waitlistService.js';

const router = Router();
const evParam = z.object({ eventId: z.string().uuid() });

router.post(
  '/:eventId',
  requireAuth,
  validate(evParam, 'params'),
  asyncHandler(async (req, res) => {
    const info = await joinWaitlist(req.params.eventId, req.user.id);
    res.status(201).json(info);
  }),
);

router.delete(
  '/:eventId',
  requireAuth,
  validate(evParam, 'params'),
  asyncHandler(async (req, res) => {
    const result = await leaveWaitlist(req.params.eventId, req.user.id);
    res.json(result);
  }),
);

router.get(
  '/:eventId',
  requireAuth,
  validate(evParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json(await getWaitlistInfo(req.params.eventId, req.user.id));
  }),
);

export default router;
