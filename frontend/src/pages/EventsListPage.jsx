import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { listEvents } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { getSocket } from '../services/socket.js';
import { eventMedia, coverErrorHandler } from '../lib/eventMedia.js';
import { inr } from '../lib/money.js';
import Icon from '../components/ui/Icon.jsx';

function useSocketLive() {
  const [live, setLive] = useState(() => getSocket().connected);
  useEffect(() => {
    const s = getSocket();
    const on = () => setLive(true);
    const off = () => setLive(false);
    s.on('connect', on);
    s.on('disconnect', off);
    return () => { s.off('connect', on); s.off('disconnect', off); };
  }, []);
  return live;
}

// Subtle, elegant background light-trail
function Swoosh() {
  return (
    <svg
      viewBox="0 0 1440 620"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="trail" x1="0" x2="1">
          <stop offset="0%" stopColor="#09090b" stopOpacity="0" />
          <stop offset="35%" stopColor="#1e293b" stopOpacity="0.25" />
          <stop offset="70%" stopColor="#475569" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d="M -60 470 C 320 250 760 560 1060 330 S 1500 170 1520 150"
        fill="none" stroke="url(#trail)" strokeWidth="20" strokeLinecap="round" opacity="0.1"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.5 }}
      />
      <motion.path
        d="M -60 470 C 320 250 760 560 1060 330 S 1500 170 1520 150"
        fill="none" stroke="url(#trail)" strokeWidth="3" strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 6px rgba(15,23,42,0.15))' }}
        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.5 }}
      />
    </svg>
  );
}

// Live interactive seat booking simulator widget inside Hero
function LiveMockSeatMap() {
  const [seats, setSeats] = useState([
    { id: 1, status: 'booked' },
    { id: 2, status: 'available' },
    { id: 3, status: 'booked' },
    { id: 4, status: 'available' },
    { id: 5, status: 'available' },
    { id: 6, status: 'available' },
    { id: 7, status: 'held', holder: 'Alex', timer: 478 },
    { id: 8, status: 'available' },
    { id: 9, status: 'booked' },
    { id: 10, status: 'available' },
    { id: 11, status: 'available' },
    { id: 12, status: 'available' },
    { id: 13, status: 'available' },
    { id: 14, status: 'booked' },
    { id: 15, status: 'available' },
    { id: 16, status: 'available' },
    { id: 17, status: 'held', holder: 'Sarah', timer: 32 },
    { id: 18, status: 'available' },
    { id: 19, status: 'available' },
    { id: 20, status: 'booked' },
  ]);

  // Tick the timers
  useEffect(() => {
    const timer = setInterval(() => {
      setSeats((prev) =>
        prev.map((s) => {
          if (s.status === 'held') {
            const nextTimer = s.timer - 1;
            if (nextTimer <= 0) {
              return { ...s, status: 'booked', timer: undefined, holder: undefined };
            }
            return { ...s, timer: nextTimer };
          }
          return s;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Live state transition simulation
  useEffect(() => {
    const stateTimer = setInterval(() => {
      setSeats((prev) => {
        const next = [...prev];
        const avail = next.filter((s) => s.status === 'available');
        if (avail.length > 0 && Math.random() > 0.45) {
          const target = avail[Math.floor(Math.random() * avail.length)];
          const idx = next.findIndex((s) => s.id === target.id);
          next[idx] = { ...next[idx], status: 'held', holder: 'User_' + Math.floor(Math.random() * 90 + 10), timer: 480 };
        } else {
          const held = next.filter((s) => s.status === 'held');
          if (held.length > 0) {
            const target = held[Math.floor(Math.random() * held.length)];
            const idx = next.findIndex((s) => s.id === target.id);
            next[idx] = { ...next[idx], status: 'booked', timer: undefined, holder: undefined };
          }
        }
        const booked = next.filter((s) => s.status === 'booked');
        if (booked.length > 8) {
          const resetTarget = booked[Math.floor(Math.random() * booked.length)];
          const idx = next.findIndex((s) => s.id === resetTarget.id);
          next[idx] = { ...next[idx], status: 'available' };
        }
        return next;
      });
    }, 3500);
    return () => clearInterval(stateTimer);
  }, []);

  const formatTimer = (secs) => {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="glass-card flex flex-col p-5 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.08)] w-full max-w-[340px] border border-white/80 self-center">
      <div className="flex items-center justify-between border-b border-slate-200/50 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Stage / Screen</span>
        </div>
        <span className="text-[10px] font-bold text-slate-800 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/50">Row A</span>
      </div>

      <div className="grid grid-cols-5 gap-2.5 justify-center">
        {seats.map((s) => {
          let bgClass = 'bg-emerald-500/90 hover:bg-emerald-500 text-white';
          let borderClass = 'border-emerald-500/20';
          if (s.status === 'booked') {
            bgClass = 'bg-slate-200 text-slate-400';
            borderClass = 'border-slate-300/10';
          } else if (s.status === 'held') {
            bgClass = 'bg-amber-400 text-slate-950 font-bold border-amber-400/40 animate-pulse';
            borderClass = 'border-amber-400';
          }
          return (
            <motion.div
              key={s.id}
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl border text-[10px] font-bold transition-all ${bgClass} ${borderClass}`}
              title={s.status === 'held' ? `Held (${formatTimer(s.timer)})` : s.status}
            >
              {s.status === 'held' ? <Icon name="clock" size={14} /> : s.status === 'booked' ? '✕' : s.id}
              {s.status === 'held' && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-slate-900 px-1 py-0.2 text-[7px] text-white font-mono shadow leading-none scale-90 whitespace-nowrap z-10">
                  {formatTimer(s.timer)}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-200/50 pt-3 text-[10px] font-semibold text-slate-600">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-emerald-500/90 inline-block shadow-sm" />
          <span>Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-amber-400 inline-block shadow-sm animate-pulse" />
          <span>Held (8m)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-slate-200 inline-block shadow-sm" />
          <span>Booked</span>
        </div>
      </div>
    </div>
  );
}

const HERO_IMG = 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1920&q=72';
const HERO_FALLBACK = 'https://picsum.photos/seed/seatlive-hero/1920/900';

function Hero({ eventCount, live, authed }) {
  return (
    <section className="full-bleed hero-mesh relative flex min-h-[580px] flex-col items-center justify-center overflow-hidden sm:min-h-[660px] px-4 py-12">
      {/* Background crowd image structure styled with low opacity & white frosted layer */}
      <img
        src={HERO_IMG}
        onError={coverErrorHandler(HERO_FALLBACK)}
        alt=""
        className="animate-hero-zoom absolute inset-0 h-full w-full object-cover opacity-[0.06] mix-blend-overlay pointer-events-none"
      />
      <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px] pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#f8fafc] via-[#f8fafc]/40 to-transparent pointer-events-none" />
      <Swoosh />

      <div className="relative z-10 w-full max-w-6xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-12 pt-16 px-4 sm:px-8">
        {/* Left Column: Headings & Copy */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
          className="flex flex-col items-start text-left lg:w-[55%]"
        >
          <motion.p
            variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
            className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.35em] text-slate-500"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-emerald-500 animate-pulse-dot' : 'bg-slate-400'}`} />
            #1 Real-Time Seat Booking Technology
          </motion.p>

          <motion.h1
            variants={{ hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="mt-4 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-6xl"
          >
            Every Seat,
            <br />
            Claimed in <span className="text-gradient">Real Time</span>
          </motion.h1>

          <motion.p
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            className="mt-6 text-sm sm:text-base leading-relaxed text-slate-600 max-w-lg"
          >
            Hold a seat for 8 minutes, pay securely, and watch the map update live for
            everyone — no refreshes, no double-booking, and absolute transparency.
          </motion.p>

          <motion.div
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            className="mt-8 flex flex-wrap items-center gap-3 w-full sm:w-auto"
          >
            {authed ? (
              <a href="#events" className="btn-primary !px-8 !py-3.5 text-base uppercase tracking-wide shadow-md w-full sm:w-auto">
                Browse {eventCount || ''} live event{eventCount === 1 ? '' : 's'} ↓
              </a>
            ) : (
              <>
                <Link to="/register" className="btn-primary !px-8 !py-3.5 text-base uppercase tracking-wide shadow-md w-full sm:w-auto">
                  Get started now
                </Link>
                <a
                  href="#events"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white/70 px-6 py-3.5 text-sm font-semibold text-slate-700 backdrop-blur transition hover:bg-white hover:border-slate-300 shadow-sm w-full sm:w-auto"
                >
                  Browse events
                </a>
              </>
            )}
          </motion.div>
        </motion.div>

        {/* Right Column: Dynamic Mock Widget */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6, ease: 'easeOut' }}
          className="flex items-center justify-center lg:w-[45%] w-full"
        >
          <div className="relative">
            <div className="absolute -inset-1 rounded-[32px] bg-gradient-to-r from-slate-900 to-slate-950 opacity-[0.05] blur-xl" />
            <LiveMockSeatMap />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function AvailabilityBar({ available, total }) {
  const pct = total ? Math.round((available / total) * 100) : 0;
  const tone = pct === 0 ? 'from-rose-500 to-rose-600' : pct < 30 ? 'from-amber-400 to-orange-500' : 'from-emerald-400 to-teal-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] font-semibold text-slate-500">
        <span>{available === 0 ? 'Sold out' : `${available} of ${total} left`}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/60">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: 'easeOut', delay: 0.15 }}
          className={`h-full rounded-full bg-gradient-to-r ${tone}`}
        />
      </div>
    </div>
  );
}

function EventCard({ ev, isAdmin, index }) {
  const media = eventMedia(ev);
  const date = new Date(ev.event_date);
  const soldOut = ev.available_seats === 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: (index % 3) * 0.08, ease: 'easeOut' }}
      className="group flex flex-col glass-card overflow-hidden hover:shadow-[0_20px_40px_-12px_rgba(15,23,42,0.08)] hover:-translate-y-1.5 transition-all duration-300"
    >
      <Link
        to={`/events/${ev.id}`}
        className="relative block h-48 overflow-hidden"
      >
        <div className={`absolute inset-0 bg-gradient-to-br ${media.gradient}`} />
        <img
          src={media.image}
          onError={coverErrorHandler(media.fallback)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        
        {/* Date badge over image */}
        <div className="absolute left-3.5 top-3.5 flex flex-col items-center rounded-xl border border-white/20 bg-black/40 px-2.5 py-1.5 text-white backdrop-blur-sm">
          <span className="font-display text-sm font-extrabold leading-none">{date.getDate()}</span>
          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-200">
            {date.toLocaleString('en', { month: 'short' })}
          </span>
        </div>

        {/* Pricing badge */}
        {soldOut ? (
          <span className="chip-onmedia absolute right-3.5 top-3.5 !text-rose-250 !bg-rose-950/50">Sold out</span>
        ) : (
          <span className="chip-onmedia absolute right-3.5 top-3.5 !text-emerald-250 !bg-emerald-950/50">from {inr(ev.base_price)}</span>
        )}

        <div className="absolute bottom-3.5 left-3.5 right-3.5 text-white">
          <h3 className="font-display text-lg font-bold leading-snug drop-shadow-sm">{ev.name}</h3>
        </div>
      </Link>

      <div className="flex-1 flex flex-col justify-between p-5 space-y-4">
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <Icon name="pin" size={13} className="text-slate-400" />
            <span className="truncate">{ev.venue}</span>
            <span>·</span>
            <span>{date.toLocaleDateString([], { dateStyle: 'short' })}</span>
          </p>
          <AvailabilityBar available={ev.available_seats} total={ev.total_seats} />
        </div>
        
        <div className="flex items-center justify-between pt-3.5 border-t border-slate-100/80">
          <Link
            to={`/events/${ev.id}`}
            className={`text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${soldOut ? 'text-slate-500 hover:text-slate-700' : 'text-slate-950 hover:text-slate-800'}`}
          >
            {soldOut ? 'Join waitlist' : 'Pick seats'}
            <span className="transition-transform group-hover:translate-x-1 inline-block">→</span>
          </Link>
          {isAdmin && (
            <Link to={`/events/${ev.id}/dashboard`} className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1" title="Analytics">
              <Icon name="chart" size={13} />
              <span>Analytics</span>
            </Link>
          )}
        </div>
      </div>
    </motion.article>
  );
}

const STEPS = [
  ['pointer', 'Choose Your Seats', 'Browse our live seat map. Free seats are green; seats currently selected by others pulse in amber.'],
  ['timer', '8-Minute Hold Lock', 'Once you click a seat, an atomic Redis lock reserves it for 8 minutes so you can checkout without stress.'],
  ['ticket', 'Instant Bookings', 'The moment payment clears, the seat flips to red instantly for everyone. No refreshes, no double bookings.'],
];

export default function EventsListPage() {
  const { isAdmin, status } = useAuth();
  const live = useSocketLive();
  const { data, isLoading, error } = useQuery({ queryKey: ['events'], queryFn: () => listEvents(1, 50) });
  const events = data?.events || [];

  return (
    <div className="space-y-8">
      <Hero eventCount={events.length} live={live} authed={status === 'authed'} />

      {/* how it works — elegant white glass cards, hover scaling */}
      <section className="mx-auto grid max-w-5xl gap-6 py-12 sm:grid-cols-3 px-4">
        {STEPS.map(([icon, title, body], i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.5 }}
            className="glass-card flex flex-col p-6 hover:shadow-md hover:-translate-y-1.5 transition-all duration-300"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl shadow-sm border border-slate-200/50 self-start"><Icon name={icon} size={22} className="text-slate-700" /></span>
            <h3 className="mt-4 font-display text-lg font-bold text-slate-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
          </motion.div>
        ))}
      </section>

      {/* events */}
      <section id="events" className="scroll-mt-24 pb-8 px-4 max-w-6xl mx-auto">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl font-extrabold text-slate-900">
              Upcoming <span className="text-gradient">events</span>
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">Live seat availability updates in real-time as seats are booked.</p>
          </div>
          {isAdmin && <Link to="/admin" className="btn-ghost !py-1.5 text-xs shadow-sm hover:shadow">+ Create event</Link>}
        </div>

        {isLoading && (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[340px] rounded-3xl" />)}
          </div>
        )}
        {error && <p className="text-rose-600 font-medium text-center py-12">Failed to load events — is the backend stack running?</p>}
        {!isLoading && events.length === 0 && (
          <div className="glass-card p-12 text-center text-slate-500 border border-slate-200/50">
            No events found. Admin accounts can create new events from the Admin control panel.
          </div>
        )}

        <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((ev, i) => <EventCard key={ev.id} ev={ev} isAdmin={isAdmin} index={i} />)}
        </div>
      </section>
    </div>
  );
}
