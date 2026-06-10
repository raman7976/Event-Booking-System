// All HTTP calls. baseURL '/api' is proxied by Vite to nginx in dev. A JWT is
// kept in localStorage; for a frictionless demo we auto-create a guest account.
import axios from 'axios';

const TOKEN_KEY = 'bk_token';
const USER_KEY = 'bk_user';

export const api = axios.create({ baseURL: '/api' });

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
};
const setAuth = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearAuth = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export const apiError = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';
export const apiErrorCode = (err) => err?.response?.data?.error?.code || null;

// ── Auth ──
export async function register(email, password, name) {
  const { data } = await api.post('/auth/register', { email, password, name });
  setAuth(data.token, data.user);
  return data.user;
}
export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  setAuth(data.token, data.user);
  return data.user;
}
export async function ensureGuest() {
  if (getToken() && getUser()) return getUser();
  const rnd = Math.random().toString(36).slice(2, 7);
  return register(`guest_${rnd}_${Date.now()}@guests.local`, 'guestpass123', `Guest-${rnd}`);
}
export async function newGuest() {
  clearAuth();
  return ensureGuest();
}

// ── Events ──
export const listEvents = (page = 1, limit = 20) =>
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
