// Campus bus API. Reading the schedule/waitlist is public; every booking
// action requires an @lnmiit.ac.in account with a roll number on the profile.
import { Router } from 'express';
import { z } from 'zod';
import {
  requireAuth, optionalAuth, requireCampusEmail, requireRollNumber, requireRole,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  schedule, tripDetail, myTrips,
  book, cancel, confirm, decline, joinWaitlist, leaveWaitlist,
} from '../controllers/busController.js';
import {
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  listHolidays, addHoliday, removeHoliday, tripManifest, regenerate,
} from '../controllers/busAdminController.js';

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

// ── transport admin ──
const admin = [requireAuth, requireRole('admin')];
const timeRe = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const createScheduleSchema = z.object({
  busNo: z.coerce.number().int().min(1).max(99),
  origin: z.string().min(2).max(100),
  destination: z.string().min(2).max(100),
  departureTime: z.string().regex(timeRe, 'departureTime must be HH:MM'),
  pattern: z.enum(['weekday', 'weekend_holiday']),
  weekdayOnly: z.coerce.number().int().min(1).max(5).optional(),
  capacity: z.coerce.number().int().min(1).max(100).default(40),
});
const updateScheduleSchema = z.object({
  capacity: z.coerce.number().int().min(1).max(100).optional(),
  active: z.boolean().optional(),
});
const holidaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().max(120).optional(),
});
const dayParam = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const generateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.get('/admin/schedules', ...admin, listSchedules);
router.post('/admin/schedules', ...admin, validate(createScheduleSchema), createSchedule);
router.put('/admin/schedules/:id', ...admin, validate(idParam, 'params'), validate(updateScheduleSchema), updateSchedule);
router.delete('/admin/schedules/:id', ...admin, validate(idParam, 'params'), deleteSchedule);
router.get('/admin/holidays', ...admin, listHolidays);
router.post('/admin/holidays', ...admin, validate(holidaySchema), addHoliday);
router.delete('/admin/holidays/:day', ...admin, validate(dayParam, 'params'), removeHoliday);
router.get('/admin/trips/:id/manifest', ...admin, validate(idParam, 'params'), tripManifest);
router.post('/admin/generate', ...admin, validate(generateSchema), regenerate);

export default router;
