import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { myBookings, busMyTrips } from '../services/api.js';
import { eventMedia, coverErrorHandler } from '../lib/eventMedia.js';
import CountdownTimer from '../components/CountdownTimer.jsx';
import { MY_CHIP, MY_CHIP_LABEL } from './BusSchedulePage.jsx';
import Icon from '../components/ui/Icon.jsx';
import { inr } from '../lib/money.js';

const STATUS_CHIP = {
  confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  held: 'border-amber-200 bg-amber-50 text-amber-700',
  expired: 'border-slate-200 bg-slate-50 text-slate-500',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
};

const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function BusTripsTab() {
  const { data: trips = [], isLoading, error } = useQuery({ queryKey: ['bus-my-trips'], queryFn: busMyTrips });

  if (isLoading) {
    return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>;
  }
  if (error) return <p className="text-rose-500">Failed to load bus trips.</p>;
  if (!trips.length) {
    return (
      <div className="glass p-12 text-center">
        <Icon name="bus" size={40} className="mx-auto text-slate-300" />
        <p className="mt-3 font-display font-semibold text-slate-800">No bus trips yet</p>
        <p className="mt-1 text-sm text-slate-500">Booking opens one hour before each departure.</p>
        <Link to="/bus" className="btn-primary mt-5">Today&apos;s schedule</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {trips.map((t, i) => {
        const chipKey = t.bookingStatus || (t.waitlisted ? 'waitlisted' : null);
        const muted = ['declined', 'cancelled', 'auto_released', 'no_show'].includes(t.bookingStatus) || t.tripStatus === 'departed';
        return (
          <motion.div
            key={t.tripId}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
          >
            <Link
              to={`/bus/trips/${t.tripId}`}
              className={`glass-card flex flex-wrap items-center gap-4 p-4 transition hover:-translate-y-0.5 ${muted ? 'opacity-60' : ''}`}
            >
              <div className="w-20">
                <div className="font-display text-lg font-extrabold text-slate-900">{hhmm(t.departureAt)}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Bus {t.busNo}</div>
              </div>
              <div className="flex-1">
                <div className="font-display text-sm font-bold text-slate-800">{t.origin} → {t.destination}</div>
                <div className="text-xs text-slate-400">
                  {new Date(t.departureAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                  {t.tripStatus === 'departed' && ' · departed'}
                </div>
              </div>
              {chipKey === 'waitlisted' || (!t.bookingStatus && t.waitlisted) ? (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                  Waitlisted
                </span>
              ) : (
                t.bookingStatus && (
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${MY_CHIP[t.bookingStatus] || 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                    {MY_CHIP_LABEL[t.bookingStatus] || t.bookingStatus}
                  </span>
                )
              )}
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

export default function MyBookingsPage() {
  const [tab, setTab] = useState('bus');
  const { data: bookings = [], isLoading, error, refetch } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: myBookings,
    enabled: tab === 'events',
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-5 font-display text-3xl font-extrabold text-slate-900">
        My <span className="text-gradient">bookings</span>
      </h1>

      <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {[['bus', 'Bus trips'], ['events', 'Events']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              tab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'bus' && <BusTripsTab />}

      {tab === 'events' && (
        <>
      {isLoading && (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}</div>
      )}
      {error && <p className="text-rose-400">Failed to load bookings.</p>}

      {!isLoading && bookings.length === 0 && (
        <div className="glass p-12 text-center">
          <Icon name="ticket" size={40} className="mx-auto text-slate-300" />
          <p className="mt-3 font-display font-semibold text-slate-800">No tickets yet</p>
          <p className="mt-1 text-sm text-slate-500">Grab a seat — it takes under a minute.</p>
          <Link to="/" className="btn-primary mt-5">Browse events</Link>
        </div>
      )}

      <div className="space-y-4">
        {bookings.map((b, i) => {
          const media = eventMedia(b.event);
          const muted = b.status === 'expired' || b.status === 'cancelled';
          return (
            <motion.div
              key={b.reservationId}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className={`group flex overflow-hidden rounded-2xl bg-white shadow-card transition hover:-translate-y-0.5 ${muted ? 'opacity-60' : ''}`}
            >
              {/* media stub */}
              <Link to={`/events/${b.event.id}`} className="relative hidden w-36 shrink-0 overflow-hidden sm:block">
                <div className={`absolute inset-0 bg-gradient-to-br ${media.gradient}`} />
                <img
                  src={media.image} onError={coverErrorHandler(media.fallback)} alt="" loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <span className="absolute bottom-2 left-2 font-display text-lg font-extrabold drop-shadow">
                  {b.seat.row}{b.seat.number}
                </span>
              </Link>

              <div className="flex flex-1 flex-wrap items-center justify-between gap-3 border-l border-dashed border-slate-200 p-4 sm:p-5">
                <div>
                  <div className="font-display font-bold text-slate-900">{b.event.name}</div>
                  <div className="mt-0.5 text-sm text-slate-500">
                    <Icon name="pin" size={12} className="-mt-0.5 mr-1" />{b.event.venue} · {new Date(b.event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div className="mt-1.5 text-sm text-slate-700">
                    Seat <b>{b.seat.row}{b.seat.number}</b>
                    <span className="mx-1.5 text-slate-600">·</span>{b.seat.category}
                    <span className="mx-1.5 text-slate-600">·</span>{inr(b.seat.price)}
                  </div>
                </div>

                <div className="text-right">
                  <span className={`inline-block rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_CHIP[b.status] || STATUS_CHIP.expired}`}>
                    {b.status}
                  </span>
                  {b.status === 'held' && b.expiresAt && (
                    <div className="mt-1.5 text-xs text-slate-500">
                      expires in <CountdownTimer expiresAt={b.expiresAt} onExpire={() => refetch()} />
                    </div>
                  )}
                  {b.payment && (
                    <div className="mt-1.5 font-mono text-[10px] text-slate-400">
                      {b.payment.transactionId?.slice(0, 18)}…
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}
