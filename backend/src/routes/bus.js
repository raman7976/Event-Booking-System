// Campus bus API. Reading the schedule/waitlist is public; every booking
// action requires an @lnmiit.ac.in account with a roll number on the profile.
import { Router } from 'express';
import { z } from 'zod';
import {
  requireAuth, optionalAuth, requireCampusEmail, requireRollNumber,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  schedule, tripDetail, myTrips,
  book, cancel, confirm, decline, joinWaitlist, leaveWaitlist,
} from '../controllers/busController.js';

const router = Router();

const idParam = z.object({ id: z.string().uuid() });
const dateQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

const campus = [requireAuth, requireCampusEmail, requireRollNumber];
const actionLimiter = rateLimiter({ max: 30, windowSeconds: 60, keyPrefix: 'bus' });

router.get('/schedule', optionalAuth, validate(dateQuery, 'query'), schedule);
router.get('/trips/:id', optionalAuth, validate(idParam, 'params'), tripDetail);
router.get('/me', requireAuth, myTrips);

router.post('/trips/:id/book', ...campus, actionLimiter, validate(idParam, 'params'), book);
router.delete('/trips/:id/book', ...campus, validate(idParam, 'params'), cancel);
router.post('/trips/:id/confirm', ...campus, validate(idParam, 'params'), confirm);
router.post('/trips/:id/decline', ...campus, validate(idParam, 'params'), decline);
router.post('/trips/:id/waitlist', ...campus, actionLimiter, validate(idParam, 'params'), joinWaitlist);
router.delete('/trips/:id/waitlist', ...campus, validate(idParam, 'params'), leaveWaitlist);

export default router;
