// HTTP layer. The access token lives in MEMORY only (never localStorage — XSS
// can't read it); sessions survive reloads via the httpOnly refresh cookie:
// on boot AuthContext calls refreshSession(), and any 401 triggers one silent
// refresh + retry (single-flight so parallel 401s share one refresh call).
import axios from 'axios';

// REST is always same-origin and proxied to the backend — Vite dev-proxy locally,
// and a Vercel rewrite (/api/* -> Railway) in production. This keeps the refresh
// cookie first-party (works in Safari/mobile) and reachable on mobile networks
// that can't hit the Railway host directly. (The WebSocket can't be proxied, so
// socket.js connects straight to VITE_API_URL.)
export const API_BASE = '';

export const api = axios.create({ baseURL: `${API_BASE}/api`, withCredentials: true });

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
      .post(`${API_BASE}/api/auth/refresh`, null, { withCredentials: true })
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
// A fresh Idempotency-Key per confirm attempt: axios auto-retries (e.g. the
// silent token refresh) reuse the same request config — and therefore the same
// key — so a lost response can never double-charge a hold.
export const confirmBooking = (holdToken, paymentMethod) =>
  api
    .post(
      '/bookings/confirm',
      { holdToken, paymentMethod },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    )
    .then((r) => r.data.booking);
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

// bus admin
export const busAdminSchedules = () => api.get('/bus/admin/schedules').then((r) => r.data.schedules);
export const busAdminCreateSchedule = (p) => api.post('/bus/admin/schedules', p).then((r) => r.data);
export const busAdminUpdateSchedule = (id, p) => api.put(`/bus/admin/schedules/${id}`, p).then((r) => r.data);
export const busAdminDeleteSchedule = (id) => api.delete(`/bus/admin/schedules/${id}`).then((r) => r.data);
export const busAdminHolidays = () => api.get('/bus/admin/holidays').then((r) => r.data.holidays);
export const busAdminAddHoliday = (p) => api.post('/bus/admin/holidays', p).then((r) => r.data);
export const busAdminRemoveHoliday = (day) => api.delete(`/bus/admin/holidays/${day}`).then((r) => r.data);
export const busAdminManifest = (id) => api.get(`/bus/admin/trips/${id}/manifest`).then((r) => r.data);
export const busAdminGenerate = (date) => api.post('/bus/admin/generate', date ? { date } : {}).then((r) => r.data);
export const busAdminFlags = () => api.get('/bus/admin/flags').then((r) => r.data.flags);
export const busAdminAnalyzeFlags = () => api.post('/bus/admin/flags/analyze').then((r) => r.data);
export const busAdminCapacityAdvice = () => api.get('/bus/admin/capacity-advice').then((r) => r.data);

// bus AI (agentic RAG)
export const busAssistantAsk = (message, history) =>
  api.post('/bus/assistant', { message, ...(history ? { history } : {}) }).then((r) => r.data);
export const busAdminAnalytics = (question) =>
  api.post('/bus/admin/analytics/query', { question }).then((r) => r.data);

// ── Admin ──
export const adminOverview = () => api.get('/admin/overview').then((r) => r.data);
export const adminCreateEvent = (payload) => api.post('/admin/events', payload).then((r) => r.data);
export const adminDeleteEvent = (id) => api.delete(`/admin/events/${id}`).then((r) => r.data);
export const adminEventBookings = (id) =>
  api.get(`/admin/events/${id}/bookings`).then((r) => r.data.bookings);
