// HTTP layer for the campus bus vertical — thin wrappers over busService.
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  getSchedule, getTripDetail, getMyBusTrips,
  bookSeat, cancelBooking, confirmBoarding, declineBoarding,
  joinBusWaitlist, leaveBusWaitlist,
} from '../services/busService.js';

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const schedule = asyncHandler(async (req, res) => {
  const date = req.query.date || todayStr();
  const trips = await getSchedule(date, req.user?.id || null);
  res.json({ date, trips });
});

export const tripDetail = asyncHandler(async (req, res) => {
  res.json(await getTripDetail(req.params.id, req.user?.id || null));
});

export const myTrips = asyncHandler(async (req, res) => {
  res.json({ trips: await getMyBusTrips(req.user.id) });
});

export const book = asyncHandler(async (req, res) => {
  const result = await bookSeat({ tripId: req.params.id, userId: req.user.id });
  res.status(201).json(result);
});

export const cancel = asyncHandler(async (req, res) => {
  res.json(await cancelBooking({ tripId: req.params.id, userId: req.user.id }));
});

export const confirm = asyncHandler(async (req, res) => {
  res.json(await confirmBoarding({ tripId: req.params.id, userId: req.user.id }));
});

export const decline = asyncHandler(async (req, res) => {
  res.json(await declineBoarding({ tripId: req.params.id, userId: req.user.id }));
});

export const joinWaitlist = asyncHandler(async (req, res) => {
  res.status(201).json(await joinBusWaitlist({ tripId: req.params.id, userId: req.user.id }));
});

export const leaveWaitlist = asyncHandler(async (req, res) => {
  res.json(await leaveBusWaitlist({ tripId: req.params.id, userId: req.user.id }));
});
