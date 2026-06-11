import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { listEvents } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { getSocket } from '../services/socket.js';
import { eventMedia, coverErrorHandler } from '../lib/eventMedia.js';

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

// Full-bleed photographic hero: edge-to-edge crowd photo running underneath the
// transparent navbar, slow Ken Burns zoom, animated light-trail swoosh, centered
// copy with one accent phrase, and a fade into the light page below.
const HERO_IMG = 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1920&q=72';
const HERO_FALLBACK = 'https://picsum.photos/seed/seatlive-hero/1920/900';

function Swoosh() {
  return (
    <svg
      viewBox="0 0 1440 620"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="trail" x1="0" x2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0" />
          <stop offset="35%" stopColor="#a78bfa" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#22d3ee" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d="M -60 470 C 320 250 760 560 1060 330 S 1500 170 1520 150"
        fill="none" stroke="url(#trail)" strokeWidth="22" strokeLinecap="round" opacity="0.16"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.5 }}
      />
      <motion.path
        d="M -60 470 C 320 250 760 560 1060 330 S 1500 170 1520 150"
        fill="none" stroke="url(#trail)" strokeWidth="3.5" strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 8px rgba(139,92,246,0.9))' }}
        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.5 }}
      />
    </svg>
  );
}

function Hero({ eventCount, live, authed }) {
  return (
    <section className="full-bleed relative flex min-h-[600px] flex-col items-center justify-center overflow-hidden sm:min-h-[680px]">
      <div className="absolute inset-0 bg-slate-900" />
      <img
        src={HERO_IMG}
        onError={coverErrorHandler(HERO_FALLBACK)}
        alt=""
        className="animate-hero-zoom absolute inset-0 h-full w-full object-cover"
      />
      {/* legibility scrims: darker at the top (navbar zone), fade to the light page */}
      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#f8fafc] via-[#f8fafc]/30 to-transparent" />
      <Swoosh />

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.13 } } }}
        className="relative z-10 flex max-w-3xl flex-col items-center px-4 pt-16 text-center"
      >
        <motion.p
          variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.35em] text-white/85"
        >
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400 animate-pulse-dot' : 'bg-slate-400'}`} />
          #1 real-time seat booking technology
        </motion.p>

        <motion.h1
          variants={{ hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="mt-5 font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.55)] sm:text-7xl"
        >
          Every Seat,
          <br />
          Claimed in <span className="text-gradient brightness-150">Real Time</span>
        </motion.h1>

        <motion.p
          variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } }}
          className="mt-5 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg"
        >
          Hold a seat for 8 minutes, pay securely, and watch the map update live for
          everyone — no refreshes, no double-booking.
        </motion.p>

        <motion.div
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          {authed ? (
            <a href="#events" className="btn-primary !px-8 !py-3.5 text-base uppercase tracking-wide">
              Browse {eventCount || ''} live event{eventCount === 1 ? '' : 's'} ↓
            </a>
          ) : (
            <>
              <Link to="/register" className="btn-primary !px-8 !py-3.5 text-base uppercase tracking-wide">
                Get started now
              </Link>
              <a
                href="#events"
                className="inline-flex items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
              >
                Browse events ↓
              </a>
            </>
          )}
        </motion.div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1, duration: 0.8 }}
        className="absolute inset-x-0 bottom-6 z-10 text-center text-[10px] font-semibold uppercase tracking-[0.45em] text-slate-500"
      >
        The fairest way to claim a seat
      </motion.p>
    </section>
  );
}

function AvailabilityBar({ available, total }) {
  const pct = total ? Math.round((available / total) * 100) : 0;
  const tone = pct === 0 ? 'from-rose-500 to-rose-600' : pct < 30 ? 'from-amber-400 to-orange-500' : 'from-emerald-400 to-teal-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-500">
        <span>{available === 0 ? 'Sold out' : `${available} of ${total} left`}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
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

// Boxless listing card: media with rounded corners + content directly on the
// page — no border, no panel. Hover lifts the image and deepens its shadow.
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
      className="group"
    >
      <Link
        to={`/events/${ev.id}`}
        className="relative block h-52 overflow-hidden rounded-2xl shadow-[0_10px_30px_-14px_rgba(15,23,42,0.25)] transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-[0_24px_50px_-20px_rgba(15,23,42,0.4)]"
      >
        <div className={`absolute inset-0 bg-gradient-to-br ${media.gradient}`} />
        <img
          src={media.image}
          onError={coverErrorHandler(media.fallback)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
        <div className="absolute left-3 top-3 flex flex-col items-center rounded-xl border border-white/20 bg-black/50 px-2.5 py-1.5 text-white backdrop-blur">
          <span className="font-display text-base font-extrabold leading-none">{date.getDate()}</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-200">
            {date.toLocaleString('en', { month: 'short' })}
          </span>
        </div>
        {soldOut ? (
          <span className="chip-onmedia absolute right-3 top-3 !text-rose-200">Sold out</span>
        ) : (
          <span className="chip-onmedia absolute right-3 top-3 !text-emerald-200">from ${ev.base_price}</span>
        )}
        <div className="absolute bottom-3 left-3 right-3 text-white">
          <h3 className="font-display text-lg font-bold leading-snug drop-shadow">{ev.name}</h3>
        </div>
      </Link>

      <div className="space-y-3 px-1 pt-4">
        <p className="text-sm text-slate-500">
          📍 {ev.venue} · {date.toLocaleDateString([], { dateStyle: 'medium' })} ·{' '}
          {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
        <AvailabilityBar available={ev.available_seats} total={ev.total_seats} />
        <div className="flex items-center gap-3 pt-0.5">
          <Link
            to={`/events/${ev.id}`}
            className={`text-sm font-semibold ${soldOut ? 'text-slate-500 hover:text-slate-700' : 'text-violet-700 hover:text-violet-900'}`}
          >
            {soldOut ? 'Join waitlist →' : 'Pick seats →'}
          </Link>
          {isAdmin && (
            <Link to={`/events/${ev.id}/dashboard`} className="text-sm text-slate-400 transition hover:text-slate-700" title="Analytics">
              📊 Analytics
            </Link>
          )}
        </div>
      </div>
    </motion.article>
  );
}

const STEPS = [
  ['🪑', 'Pick a seat', 'Live map — green is free, amber is being held by someone right now.'],
  ['⏱️', 'Hold it for 8 min', 'An atomic Redis lock makes the seat yours while you check out.'],
  ['🎫', 'Pay & it’s booked', 'Everyone else sees it flip to red instantly. No refresh, no double-booking.'],
];

export default function EventsListPage() {
  const { isAdmin, status } = useAuth();
  const live = useSocketLive();
  const { data, isLoading, error } = useQuery({ queryKey: ['events'], queryFn: () => listEvents(1, 50) });
  const events = data?.events || [];

  return (
    <div>
      <Hero eventCount={events.length} live={live} authed={status === 'authed'} />

      {/* how it works — borderless columns, separated by whitespace */}
      <section className="mx-auto grid max-w-5xl gap-10 py-16 sm:grid-cols-3 sm:gap-6">
        {STEPS.map(([icon, title, body], i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.45 }}
            className="text-center sm:text-left"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-2xl">{icon}</span>
            <h3 className="mt-3 font-display text-lg font-bold text-slate-900">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p>
          </motion.div>
        ))}
      </section>

      {/* events */}
      <section id="events" className="scroll-mt-24 pb-4">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl font-extrabold text-slate-900">
              Upcoming <span className="text-gradient">events</span>
            </h2>
            <p className="mt-1 text-sm text-slate-500">Availability updates live as people book.</p>
          </div>
          {isAdmin && <Link to="/admin" className="btn-ghost !py-1.5 text-xs">+ Create event</Link>}
        </div>

        {isLoading && (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-72 rounded-2xl" />)}
          </div>
        )}
        {error && <p className="text-rose-600">Failed to load events — is the backend stack up?</p>}
        {!isLoading && events.length === 0 && (
          <div className="glass p-10 text-center text-slate-500">
            No events yet — an admin can create one from the Admin panel.
          </div>
        )}

        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((ev, i) => <EventCard key={ev.id} ev={ev} isAdmin={isAdmin} index={i} />)}
        </div>
      </section>
    </div>
  );
}
