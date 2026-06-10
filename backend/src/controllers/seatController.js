// Seats: live seat list for an event, hold, and release. (recommend -> AI section)
import { asyncHandler } from '../utils/asyncHandler.js';
import { Errors } from '../utils/errors.js';
import { holdSeat, releaseHold, getEventSeats, getSeatById, recommendSeats } from '../services/seatService.js';

export const getSeats = asyncHandler(async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user?.id || null;
  const seats = await getEventSeats(eventId, userId);
  res.json({ eventId, seats });
});

export const hold = asyncHandler(async (req, res) => {
  const seatId = req.params.id;
  const { eventId } = req.body;

  const seat = await getSeatById(seatId);
  if (!seat) throw Errors.notFound('Seat not found');
  if (seat.event_id !== eventId) throw Errors.validation('eventId does not match this seat');
  if (seat.status === 'booked') throw Errors.conflict('Seat already booked');

  const result = await holdSeat({ userId: req.user.id, seatId, eventId });
  res.status(201).json(result);
});

export const release = asyncHandler(async (req, res) => {
  const { holdToken } = req.body;
  const result = await releaseHold({ userId: req.user.id, holdToken });
  res.json(result);
});

export const recommend = asyncHandler(async (req, res) => {
  const { eventId, groupSize, maxBudget, preferences } = req.body;
  const result = await recommendSeats({ eventId, groupSize, maxBudget, preferences });
  res.json(result);
});
