// Today's campus bus schedule: live seat counts, booking states, and one-tap
// booking. Free for LNMIIT accounts; one seat per rider per trip.
import { useCallback, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { busSchedule, busBook, busJoinWaitlist, apiError } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { useBusScheduleLive } from '../hooks/useBusLive.js';
import { useToast } from '../components/ui/Toast.jsx';
import RollNumberGate from '../components/RollNumberGate.jsx';

const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const TRIP_CHIP = {
  scheduled: 'border-slate-200 bg-slate-50 text-slate-500',
  open: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  confirming: 'border-amber-200 bg-amber-50 text-amber-700',
  departed: 'border-slate-200 bg-slate-100 text-slate-400',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-500',
};
export const TRIP_CHIP_LABEL = {
  scheduled: (t) => `Opens ${hhmm(t.times.opensAt)}`,
  open: () => 'Booking open',
  confirming: () => 'Confirm boarding',
  departed: () => 'Departed',
  cancelled: () => 'Cancelled',
};

export const MY_CHIP = {
  assigned: 'border-blue-200 bg-blue-50 text-blue-700',
  confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  declined: 'border-slate-200 bg-slate-50 text-slate-400',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-400',
  auto_released: 'border-rose-200 bg-rose-50 text-rose-500',
  no_show: 'border-rose-200 bg-rose-50 text-rose-500',
};
export const MY_CHIP_LABEL = {
  assigned: 'Seat assigned — confirm later',
  confirmed: 'Boarding ✓',
  declined: 'Declined',
  cancelled: 'Cancelled',
  auto_released: 'Released (no confirm)',
  no_show: 'No-show',
};

function SeatsBar({ booked, capacity }) {
  const left = capacity - booked;
  const pct = capacity ? Math.round((booked / capacity) * 100) : 0;
  const tone = left === 0 ? 'from-rose-500 to-rose-600' : pct > 70 ? 'from-amber-400 to-orange-500' : 'from-emerald-400 to-teal-500';
  return (
    <div className="w-full max-w-[180px]">
      <div className="mb-1 flex justify-between text-[10px] font-semibold text-slate-500">
        <span>{left === 0 ? 'Full' : `${left} seats left`}</span>
        <span>{booked}/{capacity}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TripRow({ trip, index, onBook, onWaitlist, busyId }) {
  const navigate = useNavigate();
  const muted = trip.status === 'departed' || trip.status === 'cancelled';
  const full = trip.booked >= trip.capacity;
  const busy = busyId === trip.id;

  let action = null;
  if (trip.myStatus === 'assigned' || trip.myStatus === 'confirmed') {
    action = (
      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${MY_CHIP[trip.myStatus]}`}>
        {MY_CHIP_LABEL[trip.myStatus]}
      </span>
    );
  } else if (trip.myWaitlistPosition) {
    action = (
      <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
        Waitlist #{trip.myWaitlistPosition}
      </span>
    );
  } else if (trip.status === 'open' || trip.status === 'confirming') {
    action = full ? (
      <button
        type="button" disabled={busy}
        onClick={(e) => { e.stopPropagation(); onWaitlist(trip); }}
        className="btn-ghost !px-3 !py-1.5 text-xs"
      >
        {busy ? '…' : `Join waitlist${trip.waitlistCount ? ` (${trip.waitlistCount})` : ''}`}
      </button>
    ) : (
      <button
        type="button" disabled={busy}
        onClick={(e) => { e.stopPropagation(); onBook(trip); }}
        className="btn-primary !px-4 !py-1.5 text-xs"
      >
        {busy ? 'Booking…' : 'Book seat'}
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-20px' }}
      transition={{ delay: (index % 6) * 0.04, duration: 0.35 }}
      onClick={() => navigate(`/bus/trips/${trip.id}`)}
      className={`glass-card flex cursor-pointer flex-wrap items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-16px_rgba(15,23,42,0.18)] ${muted ? 'opacity-55' : ''}`}
    >
      {/* time + bus */}
      <div className="w-20">
        <div className="font-display text-xl font-extrabold text-slate-900">{hhmm(trip.departureAt)}</div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Bus {trip.busNo}</div>
      </div>

      {/* route */}
      <div className="min-w-[180px] flex-1">
        <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-800">
          {trip.origin}
          <svg width="26" height="8" viewBox="0 0 26 8" className="text-slate-300"><path d="M0 4h22m0 0l-4-3m4 3l-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
          {trip.destination}
        </div>
        <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TRIP_CHIP[trip.status]}`}>
          {TRIP_CHIP_LABEL[trip.status](trip)}
        </span>
        {trip.waitlistCount > 0 && (
          <span className="ml-1.5 text-[10px] font-semibold text-violet-600">{trip.waitlistCount} waiting</span>
        )}
      </div>

      {!muted && <SeatsBar booked={trip.booked} capacity={trip.capacity} />}
      <div className="ml-auto" onClick={(e) => e.stopPropagation()}>{action}</div>
    </motion.div>
  );
}

const PERIODS = [
  ['Morning', (h) => h < 12],
  ['Afternoon', (h) => h >= 12 && h < 17],
  ['Evening', (h) => h >= 17],
];

export default function BusSchedulePage() {
  const { status: authStatus, isCampus, hasRoll } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [busyId, setBusyId] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['bus-schedule', undefined], queryFn: () => busSchedule() });

  const onPromoted = useCallback(
    () => toast.push("You're off the waitlist — seat assigned!", 'live', 8000),
    [toast],
  );
  useBusScheduleLive(undefined, { onPromoted });

  const canAct = authStatus === 'authed' && isCampus && hasRoll;
  const guard = () => {
    if (authStatus !== 'authed') { navigate('/login', { state: { from: location } }); return false; }
    if (!canAct) { toast.push('See the banner above — campus account + roll number needed.', 'info'); return false; }
    return true;
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ['bus-schedule', undefined] });

  const onBook = async (trip) => {
    if (!guard()) return;
    setBusyId(trip.id);
    try {
      await busBook(trip.id);
      toast.push(`Seat assigned on Bus ${trip.busNo} · ${hhmm(trip.departureAt)}`, 'success');
      refresh();
    } catch (err) {
      toast.push(apiError(err), 'error', 6000);
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  const onWaitlist = async (trip) => {
    if (!guard()) return;
    setBusyId(trip.id);
    try {
      const r = await busJoinWaitlist(trip.id);
      toast.push(`Joined the waitlist — you're #${r.position}.`, 'success');
      refresh();
    } catch (err) {
      toast.push(apiError(err), 'error', 6000);
    } finally {
      setBusyId(null);
    }
  };

  const trips = data?.trips || [];
  const dateLabel = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-slate-900">
            Campus <span className="text-gradient">bus</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {dateLabel} · booking opens 1 hour before departure · free, one seat per rider
          </p>
        </div>
        <span className="chip !text-cyan-700">
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-cyan-500" />
          live seat counts
        </span>
      </div>

      <div className="mb-6"><RollNumberGate /></div>

      {isLoading && (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>
      )}
      {!isLoading && trips.length === 0 && (
        <div className="glass p-10 text-center text-slate-500">No buses scheduled today.</div>
      )}

      {PERIODS.map(([label, match]) => {
        const group = trips.filter((t) => match(new Date(t.departureAt).getHours()));
        if (!group.length) return null;
        return (
          <section key={label} className="mb-7">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-slate-400">{label}</h2>
            <div className="space-y-3">
              {group.map((t, i) => (
                <TripRow key={t.id} trip={t} index={i} onBook={onBook} onWaitlist={onWaitlist} busyId={busyId} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="mt-8 text-center text-xs text-slate-400">
        Confirm boarding from 20 minutes before departure — unconfirmed seats are released to the
        waitlist 10 minutes before the bus leaves. <Link to="/my-bookings" className="text-violet-600 underline">Your trips →</Link>
      </p>
    </div>
  );
}
