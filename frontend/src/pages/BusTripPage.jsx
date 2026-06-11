// Single trip: live status, book/cancel, the confirm-to-board flow (with the
// auto-release deadline ring), and the PUBLIC waitlist (name + roll + position).
import { useCallback, useState } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  busTrip, busBook, busCancel, busConfirm, busDecline,
  busJoinWaitlist, busLeaveWaitlist, apiError,
} from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { useBusTripLive } from '../hooks/useBusLive.js';
import { useToast } from '../components/ui/Toast.jsx';
import RollNumberGate from '../components/RollNumberGate.jsx';
import CountdownTimer from '../components/CountdownTimer.jsx';
import ProgressRing from '../components/ui/ProgressRing.jsx';
import { TRIP_CHIP, TRIP_CHIP_LABEL } from './BusSchedulePage.jsx';

const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function BusTripPage() {
  const { id } = useParams();
  const { status: authStatus, isCampus, hasRoll, user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  const { data: trip, isLoading } = useQuery({
    queryKey: ['bus-trip', id],
    queryFn: () => busTrip(id),
    enabled: Boolean(id),
  });

  const onPromoted = useCallback(
    () => toast.push("You're off the waitlist — seat assigned on this bus! 🎉", 'live', 8000),
    [toast],
  );
  useBusTripLive(id, { onPromoted });

  if (isLoading || !trip) {
    return <div className="mx-auto max-w-3xl space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}</div>;
  }

  const canAct = authStatus === 'authed' && isCampus && hasRoll;
  const guard = () => {
    if (authStatus !== 'authed') { navigate('/login', { state: { from: location } }); return false; }
    if (!canAct) { toast.push('Campus account + roll number needed (see banner).', 'info'); return false; }
    return true;
  };

  const act = (fn, success) => async () => {
    if (!guard()) return;
    setBusy(true);
    try {
      const r = await fn(id);
      if (success) toast.push(typeof success === 'function' ? success(r) : success, 'success');
      qc.invalidateQueries({ queryKey: ['bus-trip', id] });
    } catch (err) {
      toast.push(apiError(err), 'error', 6000);
      qc.invalidateQueries({ queryKey: ['bus-trip', id] });
    } finally {
      setBusy(false);
    }
  };

  const mine = trip.myBooking?.status;
  const active = mine === 'assigned' || mine === 'confirmed';
  const full = trip.booked >= trip.capacity;
  const open = trip.status === 'open' || trip.status === 'confirming';
  const confirmWindow = Date.now() >= new Date(trip.times.confirmAt).getTime() && trip.status !== 'departed' && trip.status !== 'cancelled';
  const seatsLeft = trip.capacity - trip.booked;
  const onWaitlist = trip.waitlist.some((w) => w.isMe);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/bus" className="text-xs font-medium text-slate-400 transition hover:text-slate-700">← Today&apos;s schedule</Link>

      {/* header card */}
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 text-lg text-white shadow-glow-sm">🚌</span>
              <div>
                <h1 className="font-display text-2xl font-extrabold text-slate-900">
                  {trip.origin} → {trip.destination}
                </h1>
                <p className="text-sm text-slate-500">
                  Bus {trip.busNo} · {new Date(trip.departureAt).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-3xl font-extrabold text-slate-900">{hhmm(trip.departureAt)}</div>
            <span className={`mt-1 inline-block rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${TRIP_CHIP[trip.status]}`}>
              {TRIP_CHIP_LABEL[trip.status](trip)}
            </span>
          </div>
        </div>

        {/* timeline strip */}
        <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center text-[11px]">
          <div>
            <div className="font-bold text-slate-700">{hhmm(trip.times.opensAt)}</div>
            <div className="text-slate-400">booking opens</div>
          </div>
          <div>
            <div className="font-bold text-slate-700">{hhmm(trip.times.confirmAt)}</div>
            <div className="text-slate-400">confirm from</div>
          </div>
          <div>
            <div className="font-bold text-slate-700">{hhmm(trip.times.releaseAt)}</div>
            <div className="text-slate-400">unconfirmed released</div>
          </div>
        </div>

        {/* capacity */}
        {trip.status !== 'departed' && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs font-semibold text-slate-500">
              <span>{seatsLeft === 0 ? 'Bus is full' : `${seatsLeft} of ${trip.capacity} seats left`}</span>
              <span>{trip.booked}/{trip.capacity}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200/70">
              <div
                className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${seatsLeft === 0 ? 'from-rose-500 to-rose-600' : 'from-emerald-400 to-teal-500'}`}
                style={{ width: `${Math.round((trip.booked / trip.capacity) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </motion.section>

      <RollNumberGate />

      {/* my seat / actions */}
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="glass-card p-6">
        {trip.status === 'scheduled' && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Booking opens at <b className="text-slate-900">{hhmm(trip.times.opensAt)}</b> — 1 hour before departure.
            </p>
            <span className="text-sm font-semibold text-slate-500">
              opens in <CountdownTimer expiresAt={trip.times.opensAt} onExpire={() => qc.invalidateQueries({ queryKey: ['bus-trip', id] })} />
            </span>
          </div>
        )}

        {open && !active && !onWaitlist && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {full ? 'Bus is full — freed seats go to the waitlist in order.' : 'A seat is yours in one tap — no seat selection needed.'}
            </p>
            {full ? (
              <button type="button" disabled={busy} onClick={act(busJoinWaitlist, (r) => `Joined — you're #${r.position} in line.`)} className="btn-ghost">
                {busy ? '…' : `Join waitlist (${trip.waitlist.length} waiting)`}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={act(busBook, 'Seat assigned ✓')} className="btn-primary !px-7">
                {busy ? 'Booking…' : 'Book my seat'}
              </button>
            )}
          </div>
        )}

        {onWaitlist && !active && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              You&apos;re <b className="text-violet-700">#{trip.waitlist.find((w) => w.isMe)?.position}</b> on the waitlist —
              we&apos;ll assign you a seat automatically and ping you live.
            </p>
            <button type="button" disabled={busy} onClick={act(busLeaveWaitlist, 'Left the waitlist.')} className="btn-ghost">
              Leave waitlist
            </button>
          </div>
        )}

        {mine === 'assigned' && !confirmWindow && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              ✅ Seat assigned. Confirm boarding from <b className="text-slate-900">{hhmm(trip.times.confirmAt)}</b>,
              or your seat is auto-released at {hhmm(trip.times.releaseAt)}.
            </p>
            <button type="button" disabled={busy} onClick={act(busCancel, 'Booking cancelled — seat freed.')} className="btn-ghost !text-rose-600">
              Cancel booking
            </button>
          </div>
        )}

        {mine === 'assigned' && confirmWindow && (
          <div className="flex flex-wrap items-center gap-5">
            <ProgressRing
              expiresAt={trip.times.releaseAt}
              totalSeconds={Math.max(1, (new Date(trip.times.releaseAt) - new Date(trip.times.confirmAt)) / 1000)}
              size={64}
              onExpire={() => qc.invalidateQueries({ queryKey: ['bus-trip', id] })}
            />
            <div className="min-w-[200px] flex-1">
              <p className="font-display font-bold text-slate-900">Are you boarding this bus?</p>
              <p className="text-sm text-slate-500">Unconfirmed seats are released to the waitlist when the timer ends.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={act(busConfirm, "You're boarding ✓")} className="btn-primary !px-6">
                {busy ? '…' : "I'm boarding"}
              </button>
              <button type="button" disabled={busy} onClick={act(busDecline, 'Seat released to the waitlist.')} className="btn-ghost !text-rose-600">
                Not boarding
              </button>
            </div>
          </div>
        )}

        {mine === 'confirmed' && trip.status !== 'departed' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              🎫 <b className="text-emerald-700">Boarding confirmed.</b> Show up a few minutes early —
              Bus {trip.busNo} leaves {trip.origin} at <b>{hhmm(trip.departureAt)}</b> sharp.
            </p>
            <button type="button" disabled={busy} onClick={act(busDecline, 'Seat released to the waitlist.')} className="btn-ghost !text-rose-600 !py-1.5 text-xs">
              Can&apos;t make it
            </button>
          </div>
        )}

        {['declined', 'cancelled', 'auto_released', 'no_show'].includes(mine) && open && !onWaitlist && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Your previous seat was {mine.replace('_', '-')}.{!full && ' Seats are available again — you can rebook.'}
            </p>
            {!full && (
              <button type="button" disabled={busy} onClick={act(busBook, 'Seat re-assigned ✓')} className="btn-primary !py-2 text-xs">
                Rebook
              </button>
            )}
          </div>
        )}

        {trip.status === 'departed' && (
          <p className="text-sm text-slate-500">
            🏁 This bus has departed{mine === 'confirmed' ? ' — hope you caught it!' : '.'}
          </p>
        )}
      </motion.section>

      {/* public waitlist */}
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} className="glass-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display font-bold text-slate-900">Waiting list</h2>
          <span className="chip">{trip.waitlist.length} waiting</span>
        </div>
        {trip.waitlist.length === 0 ? (
          <p className="text-sm text-slate-400">Nobody is waiting — every freed seat goes to the first person who joins.</p>
        ) : (
          <ol className="space-y-2">
            {trip.waitlist.map((w) => (
              <li
                key={`${w.position}-${w.rollNumber}`}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                  w.isMe ? 'border-violet-300 bg-violet-50' : 'border-slate-100 bg-white'
                }`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${w.isMe ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {w.position}
                </span>
                <span className="font-medium text-slate-800">{w.name}{w.isMe && ' (you)'}</span>
                <span className="ml-auto font-mono text-xs text-slate-400">{w.rollNumber}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-[11px] text-slate-400">
          The waitlist is public to everyone, first-come-first-served. Freed and unconfirmed seats are
          assigned automatically in this order.
        </p>
      </motion.section>

      {user && trip.myBooking?.status === 'confirmed' && (
        <p className="text-center font-mono text-[11px] text-slate-400">
          manifest id: {user.rollNumber} · bus {trip.busNo} · {hhmm(trip.departureAt)}
        </p>
      )}
    </div>
  );
}
