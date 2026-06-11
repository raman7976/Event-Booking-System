// HTTP layer. The access token lives in MEMORY only (never localStorage — XSS
// can't read it); sessions survive reloads via the httpOnly refresh cookie:
// on boot AuthContext calls refreshSession(), and any 401 triggers one silent
// refresh + retry (single-flight so parallel 401s share one refresh call).
import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

let accessToken = null;
let sessionHandlers = {};

export const getAccessToken = () => accessToken;
export const setAccessToken = (t) => { accessToken = t; };
/** AuthContext registers callbacks so the interceptor can sync React state. */
export const bindSessionHandlers = (handlers) => { sessionHandlers = handlers; };

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshInFlight = null;
export function refreshSession() {
  refreshInFlight =
    refreshInFlight ||
    axios
      .post('/api/auth/refresh')
      .then(({ data }) => {
        accessToken = data.token;
        sessionHandlers.onSession?.(data.user);
        return data;
      })
      .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config || {};
    const isAuthCall = (original.url || '').startsWith('/auth');
    if (err.response?.status === 401 && accessToken && !original._retry && !isAuthCall) {
      original._retry = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        accessToken = null;
        sessionHandlers.onSessionLost?.();
      }
    }
    throw err;
  },
);

export const apiError = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';
export const apiFieldErrors = (err) => err?.response?.data?.error?.details || null;

// ── Auth ──
export const loginRequest = (email, password) =>
  api.post('/auth/login', { email, password }).then((r) => r.data);
export const registerRequest = (name, email, password, rollNumber) =>
  api.post('/auth/register', { name, email, password, ...(rollNumber ? { rollNumber } : {}) }).then((r) => r.data);
export const logoutRequest = () => api.post('/auth/logout').then((r) => r.data);
export const setRollNumberRequest = (rollNumber) =>
  api.patch('/auth/me', { rollNumber }).then((r) => r.data);

// ── Events ──
export const listEvents = (page = 1, limit = 50) =>
  api.get('/events', { params: { page, limit } }).then((r) => r.data);
export const getEvent = (id) => api.get(`/events/${id}`).then((r) => r.data);
export const getEventStats = (id) => api.get(`/events/${id}/stats`).then((r) => r.data);

// ── Seats ──
export const getSeats = (eventId) => api.get(`/events/${eventId}/seats`).then((r) => r.data.seats);
export const holdSeat = (seatId, eventId) =>
  api.post(`/seats/${seatId}/hold`, { eventId }).then((r) => r.data);
export const releaseHold = (seatId, holdToken) =>
  api.delete(`/seats/${seatId}/hold`, { data: { holdToken } }).then((r) => r.data);
export const recommend = (payload) => api.post('/seats/recommend', payload).then((r) => r.data);

// ── Bookings ──
export const confirmBooking = (holdToken, paymentMethod) =>
  api.post('/bookings/confirm', { holdToken, paymentMethod }).then((r) => r.data.booking);
export const myBookings = () => api.get('/bookings/mine').then((r) => r.data.bookings);

// ── Waitlist ──
export const joinWaitlist = (eventId) => api.post(`/waitlist/${eventId}`).then((r) => r.data);
export const leaveWaitlist = (eventId) => api.delete(`/waitlist/${eventId}`).then((r) => r.data);
export const getWaitlist = (eventId) => api.get(`/waitlist/${eventId}`).then((r) => r.data);

// ── Campus bus ──
export const busSchedule = (date) =>
  api.get('/bus/schedule', { params: date ? { date } : {} }).then((r) => r.data);
export const busTrip = (id) => api.get(`/bus/trips/${id}`).then((r) => r.data);
export const busMyTrips = () => api.get('/bus/me').then((r) => r.data.trips);
export const busBook = (id) => api.post(`/bus/trips/${id}/book`).then((r) => r.data);
export const busCancel = (id) => api.delete(`/bus/trips/${id}/book`).then((r) => r.data);
export const busConfirm = (id) => api.post(`/bus/trips/${id}/confirm`).then((r) => r.data);
export const busDecline = (id) => api.post(`/bus/trips/${id}/decline`).then((r) => r.data);
export const busJoinWaitlist = (id) => api.post(`/bus/trips/${id}/waitlist`).then((r) => r.data);
export const busLeaveWaitlist = (id) => api.delete(`/bus/trips/${id}/waitlist`).then((r) => r.data);

// ── Admin ──
export const adminOverview = () => api.get('/admin/overview').then((r) => r.data);
export const adminCreateEvent = (payload) => api.post('/admin/events', payload).then((r) => r.data);
export const adminDeleteEvent = (id) => api.delete(`/admin/events/${id}`).then((r) => r.data);
export const adminEventBookings = (id) =>
  api.get(`/admin/events/${id}/bookings`).then((r) => r.data.bookings);
