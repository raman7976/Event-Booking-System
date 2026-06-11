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

function Hero({ eventCount, live, authed }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 px-6 py-14 sm:px-12 sm:py-20">
      {/* animated backdrop */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-950/80 via-[#0b0b14] to-fuchsia-950/40" />
      <div className="animate-float-slow absolute -right-16 -top-20 -z-10 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
      <div className="animate-float-slower absolute -bottom-24 left-1/4 -z-10 h-80 w-80 rounded-full bg-fuchsia-600/20 blur-3xl" />
      <div className="animate-float-slow absolute right-1/3 top-1/2 -z-10 h-40 w-40 rounded-full bg-cyan-500/15 blur-2xl" />

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
        className="max-w-2xl"
      >
        <motion.span
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
          className="chip text-cyan-300"
        >
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400 animate-pulse-dot' : 'bg-slate-500'}`} />
          {live ? 'Realtime connection live' : 'Connecting…'}
        </motion.span>

        <motion.h1
          variants={{ hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl"
        >
          Every seat,
          <br />
          <span className="text-gradient">claimed in real time.</span>
        </motion.h1>

        <motion.p
          variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}
          className="mt-5 max-w-lg text-base leading-relaxed text-slate-400 sm:text-lg"
        >
          Concerts, buses, courses — watch seats turn amber as other people grab them,
          hold yours for 8 minutes, and never fight anyone for the same spot.
        </motion.p>

        <motion.div
          variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } }}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <a href="#events" className="btn-primary">
            Browse {eventCount || ''} live event{eventCount === 1 ? '' : 's'} ↓
          </a>
          {!authed && <Link to="/register" className="btn-ghost">Create free account</Link>}
        </motion.div>
      </motion.div>
    </section>
  );
}

function AvailabilityBar({ available, total }) {
  const pct = total ? Math.round((available / total) * 100) : 0;
  const tone = pct === 0 ? 'from-rose-500 to-rose-600' : pct < 30 ? 'from-amber-400 to-orange-500' : 'from-emerald-400 to-teal-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-400">
        <span>{available === 0 ? 'Sold out' : `${available} of ${total} left`}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
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
      whileHover={{ y: -6 }}
      className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-card transition-colors hover:border-violet-400/40"
    >
      {/* media */}
      <Link to={`/events/${ev.id}`} className="relative block h-44 overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-br ${media.gradient}`} />
        <img
          src={media.image}
          onError={coverErrorHandler(media.fallback)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b14] via-transparent to-transparent" />
        {/* date chip */}
        <div className="absolute left-3 top-3 flex flex-col items-center rounded-xl border border-white/15 bg-black/55 px-2.5 py-1.5 backdrop-blur">
          <span className="font-display text-base font-extrabold leading-none">{date.getDate()}</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-300">
            {date.toLocaleString('en', { month: 'short' })}
          </span>
        </div>
        {soldOut ? (
          <span className="chip absolute right-3 top-3 border-rose-400/30 text-rose-300">Sold out</span>
        ) : (
          <span className="chip absolute right-3 top-3 text-emerald-300">from ${ev.base_price}</span>
        )}
      </Link>

      {/* body */}
      <div className="space-y-3 p-5">
        <div>
          <h3 className="font-display text-lg font-bold leading-snug transition-colors group-hover:text-violet-200">
            {ev.name}
          </h3>
          <p className="mt-0.5 text-sm text-slate-400">
            📍 {ev.venue} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        <AvailabilityBar available={ev.available_seats} total={ev.total_seats} />

        <div className="flex gap-2 pt-1">
          <Link to={`/events/${ev.id}`} className={`flex-1 text-center ${soldOut ? 'btn-ghost' : 'btn-primary'} !py-2`}>
            {soldOut ? 'Join waitlist' : 'Pick seats'}
          </Link>
          {isAdmin && (
            <Link to={`/events/${ev.id}/dashboard`} className="btn-ghost !px-3 !py-2" title="Analytics">
              📊
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
    <div className="space-y-14">
      <Hero eventCount={events.length} live={live} authed={status === 'authed'} />

      {/* how it works */}
      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(([icon, title, body], i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.45 }}
            className="glass p-5"
          >
            <span className="text-2xl">{icon}</span>
            <h3 className="mt-2 font-display font-bold">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{body}</p>
          </motion.div>
        ))}
      </section>

      {/* events */}
      <section id="events" className="scroll-mt-24">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">
            Upcoming <span className="text-gradient">events</span>
          </h2>
          {isAdmin && <Link to="/admin" className="btn-ghost !py-1.5 text-xs">+ Create event</Link>}
        </div>

        {isLoading && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-80 rounded-3xl" />)}
          </div>
        )}
        {error && <p className="text-rose-400">Failed to load events — is the backend stack up?</p>}
        {!isLoading && events.length === 0 && (
          <div className="glass p-10 text-center text-slate-400">
            No events yet — an admin can create one from the Admin panel.
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((ev, i) => <EventCard key={ev.id} ev={ev} isAdmin={isAdmin} index={i} />)}
        </div>
      </section>
    </div>
  );
}
