import { useCallback, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth.js';
import {
  getEvent, recommend as apiRecommend,
  joinWaitlist, leaveWaitlist, getWaitlist, apiError,
} from '../services/api.js';
import { useSeats } from '../hooks/useSeats.js';
import { useBooking } from '../hooks/useBooking.js';
import { eventMedia, coverErrorHandler } from '../lib/eventMedia.js';
import { useToast } from '../components/ui/Toast.jsx';
import SeatMap from '../components/SeatMap.jsx';
import SeatLegend from '../components/SeatLegend.jsx';
import BookingModal from '../components/BookingModal.jsx';
import WaitlistBadge from '../components/WaitlistBadge.jsx';

const PREFS = [
  ['together', '👥'],
  ['aisle', '🚶'],
  ['front', '🎤'],
  ['back', '🪑'],
];

export default function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { status: authStatus, isAdmin } = useAuth();
  const toast = useToast();

  const requireLogin = () => navigate('/login', { state: { from: location } });

  const onWaitlistAvailable = useCallback(
    () => toast.push('A seat just opened up for you — grab it now! 🎉', 'live', 8000),
    [toast],
  );

  const { data: eventData } = useQuery({ queryKey: ['event', id], queryFn: () => getEvent(id), enabled: Boolean(id) });
  const { data: seats = [], isLoading } = useSeats(id, { onWaitlistAvailable });
  const { hold, release, confirm, busy } = useBooking(id);

  const [holdsBySeat, setHoldsBySeat] = useState({}); // seatId -> { holdToken, expiresAt, ttl }
  const [modalSeat, setModalSeat] = useState(null);
  const [confirmError, setConfirmError] = useState(null);

  // Smart Recommend
  const [groupSize, setGroupSize] = useState(2);
  const [budget, setBudget] = useState('');
  const [prefs, setPrefs] = useState(new Set(['together']));
  const [rec, setRec] = useState(null);
  const [recBusy, setRecBusy] = useState(false);

  const event = eventData?.event;
  const media = event ? eventMedia(event) : null;
  const soldOut = seats.length > 0 && seats.every((s) => s.status !== 'available');
  const myHoldCount = Object.keys(holdsBySeat).length;

  const { data: waitlistInfo, refetch: refetchWaitlist } = useQuery({
    queryKey: ['waitlist', id], queryFn: () => getWaitlist(id), enabled: Boolean(id) && authStatus === 'authed',
  });
  const [wlBusy, setWlBusy] = useState(false);

  const togglePref = (p) =>
    setPrefs((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const onSeatClick = async (seat) => {
    if (authStatus !== 'authed') return requireLogin();
    setConfirmError(null);
    if (seat.heldByMe && holdsBySeat[seat.id]) { setModalSeat(seat); return; }
    try {
      const res = await hold(seat.id);
      setHoldsBySeat((h) => ({ ...h, [seat.id]: { holdToken: res.holdToken, expiresAt: res.expiresAt, ttl: res.ttl } }));
      setModalSeat(seat);
    } catch (err) {
      toast.push(apiError(err), 'error');
    }
  };

  const onHoldExpire = (seatId) => {
    setHoldsBySeat((h) => { const n = { ...h }; delete n[seatId]; return n; });
    toast.push('Your hold expired — the seat went back on sale.', 'info');
  };

  const doConfirm = async (method) => {
    const heldInfo = holdsBySeat[modalSeat.id];
    if (!heldInfo) return;
    setConfirmError(null);
    try {
      const booking = await confirm(heldInfo.holdToken, method);
      setHoldsBySeat((h) => { const n = { ...h }; delete n[modalSeat.id]; return n; });
      setModalSeat(null);
      navigate('/confirmation', { state: { booking } });
    } catch (err) {
      setConfirmError(apiError(err));
    }
  };

  const runRecommend = async (e) => {
    e.preventDefault();
    setRecBusy(true);
    setRec(null);
    try {
      const payload = { eventId: id, groupSize: Number(groupSize), preferences: [...prefs] };
      if (budget) payload.maxBudget = Number(budget);
      setRec(await apiRecommend(payload));
    } catch (err) {
      toast.push(apiError(err), 'error');
    } finally {
      setRecBusy(false);
    }
  };

  // One-click hold of every recommended seat; rolls back on partial failure.
  const holdRecommended = async () => {
    if (authStatus !== 'authed') return requireLogin();
    if (!rec?.recommendedSeatIds?.length) return;
    const held = [];
    try {
      for (const seatId of rec.recommendedSeatIds) {
        const res = await hold(seatId);
        held.push({ seatId, holdToken: res.holdToken, expiresAt: res.expiresAt, ttl: res.ttl });
      }
      setHoldsBySeat((h) => {
        const n = { ...h };
        held.forEach((x) => { n[x.seatId] = { holdToken: x.holdToken, expiresAt: x.expiresAt, ttl: x.ttl }; });
        return n;
      });
      toast.push(`Held ${held.length} seat${held.length > 1 ? 's' : ''} — click any blue seat to pay.`, 'success');
      setRec(null);
    } catch (err) {
      for (const x of held) await release(x.seatId, x.holdToken);
      toast.push(`Couldn't hold all seats (${apiError(err)}). Rolled the partial hold back.`, 'error', 6000);
    }
  };

  const doJoinWaitlist = async () => {
    if (authStatus !== 'authed') return requireLogin();
    setWlBusy(true);
    try {
      await joinWaitlist(id);
      await refetchWaitlist();
      toast.push("You're on the list — we'll ping you live when a seat frees up.", 'success');
    } catch (err) {
      toast.push(apiError(err), 'error');
    } finally {
      setWlBusy(false);
    }
  };
  const doLeaveWaitlist = async () => {
    setWlBusy(true);
    try { await leaveWaitlist(id); await refetchWaitlist(); } catch { /* ignore */ } finally { setWlBusy(false); }
  };

  return (
    <div className="space-y-6">
      {/* ─── cover banner ─── */}
      <motion.section
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative h-60 overflow-hidden rounded-3xl border border-white/10 sm:h-72"
      >
        {media && (
          <>
            <div className={`absolute inset-0 bg-gradient-to-br ${media.gradient}`} />
            <img
              src={media.image}
              onError={coverErrorHandler(media.fallback)}
              alt=""
              className="h-full w-full object-cover"
            />
          </>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070d] via-[#07070d]/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-6 sm:p-8">
          <div>
            <Link to="/" className="text-xs font-medium text-slate-300/80 transition hover:text-white">
              ← All events
            </Link>
            <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight drop-shadow sm:text-4xl">
              {event?.name || '…'}
            </h1>
            {event && (
              <p className="mt-1 text-sm text-slate-300">
                📍 {event.venue} · 🗓 {new Date(event.event_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {event && (
              <span className="chip text-emerald-300">
                {event.available_seats} seats left
              </span>
            )}
            {isAdmin && (
              <Link to={`/events/${id}/dashboard`} className="btn-ghost !py-2 text-xs">📊 Dashboard</Link>
            )}
          </div>
        </div>
      </motion.section>

      {/* ─── AI recommender ─── */}
      <motion.form
        onSubmit={runRecommend}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className={`relative overflow-hidden rounded-2xl border bg-white/[0.03] p-5 backdrop-blur transition-colors ${
          recBusy ? 'border-fuchsia-400/50' : 'border-white/10'
        }`}
      >
        {recBusy && (
          <motion.div
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-cyan-400"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
          />
        )}
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-fuchsia-600/30 text-lg">
              ✨
            </span>
            <div>
              <div className="font-display text-sm font-bold">Smart seat finder</div>
              <div className="text-xs text-slate-400">Gemini-powered, with a heuristic fallback</div>
            </div>
          </div>

          <label className="text-xs text-slate-400">
            Group
            <input
              type="number" min="1" max="20" value={groupSize}
              onChange={(e) => setGroupSize(e.target.value)}
              className="input-field mt-1 !w-20 !py-1.5"
            />
          </label>
          <label className="text-xs text-slate-400">
            Budget ($)
            <input
              type="number" min="0" value={budget} placeholder="any"
              onChange={(e) => setBudget(e.target.value)}
              className="input-field mt-1 !w-24 !py-1.5"
            />
          </label>

          <div className="flex flex-wrap gap-1.5">
            {PREFS.map(([p, icon]) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePref(p)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  prefs.has(p)
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-glow-sm scale-105'
                    : 'border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {icon} {p}
              </button>
            ))}
          </div>

          <button type="submit" disabled={recBusy} className="btn-primary ml-auto !py-2">
            {recBusy ? 'Thinking…' : 'Find my seats'}
          </button>
        </div>

        <AnimatePresence>
          {rec && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-400/20 bg-violet-950/40 p-4">
                <div className="flex-1 text-sm text-violet-100">
                  <span className="mr-2">💡</span>{rec.reason}
                  <span className="ml-2 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {rec.source}{rec.model ? ` · ${rec.model}` : ''}
                  </span>
                </div>
                {rec.recommendedSeatIds.length > 0 && (
                  <button type="button" onClick={holdRecommended} className="btn-primary !py-2">
                    Hold {rec.recommendedSeatIds.length} seat{rec.recommendedSeatIds.length > 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.form>

      {soldOut && (
        <WaitlistBadge info={waitlistInfo ?? { onWaitlist: false, size: 0 }} onJoin={doJoinWaitlist} onLeave={doLeaveWaitlist} busy={wlBusy} />
      )}

      {/* ─── seat map ─── */}
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="glass p-5 sm:p-7"
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <SeatLegend />
          {myHoldCount > 0 && (
            <span className="chip border-blue-400/30 text-blue-200">
              {myHoldCount} seat{myHoldCount > 1 ? 's' : ''} on hold — click to pay
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2.5">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton mx-auto h-9 max-w-md rounded-lg" />)}
          </div>
        ) : (
          <SeatMap seats={seats} onSeatClick={onSeatClick} holdsBySeat={holdsBySeat} onHoldExpire={onHoldExpire} />
        )}
        {authStatus !== 'authed' && !isLoading && (
          <p className="mt-6 text-center text-sm text-slate-500">
            👀 You&apos;re browsing live data — <Link to="/login" state={{ from: location }} className="text-violet-300 underline">sign in</Link> to grab a seat.
          </p>
        )}
      </motion.section>

      <AnimatePresence>
        {modalSeat && (
          <BookingModal
            seat={modalSeat}
            hold={holdsBySeat[modalSeat.id]}
            onConfirm={doConfirm}
            onCancel={() => setModalSeat(null)}
            busy={busy}
            error={confirmError}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
