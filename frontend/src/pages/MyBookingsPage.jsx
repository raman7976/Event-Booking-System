import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { myBookings } from '../services/api.js';
import { eventMedia, coverErrorHandler } from '../lib/eventMedia.js';
import CountdownTimer from '../components/CountdownTimer.jsx';

const STATUS_CHIP = {
  confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  held: 'border-amber-200 bg-amber-50 text-amber-700',
  expired: 'border-slate-200 bg-slate-50 text-slate-500',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
};

export default function MyBookingsPage() {
  const { data: bookings = [], isLoading, error, refetch } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: myBookings,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 font-display text-3xl font-extrabold text-slate-900">
        My <span className="text-gradient">bookings</span>
      </h1>

      {isLoading && (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}</div>
      )}
      {error && <p className="text-rose-400">Failed to load bookings.</p>}

      {!isLoading && bookings.length === 0 && (
        <div className="glass p-12 text-center">
          <div className="text-4xl">🎫</div>
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
                    📍 {b.event.venue} · {new Date(b.event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div className="mt-1.5 text-sm text-slate-700">
                    Seat <b>{b.seat.row}{b.seat.number}</b>
                    <span className="mx-1.5 text-slate-600">·</span>{b.seat.category}
                    <span className="mx-1.5 text-slate-600">·</span>${b.seat.price}
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
    </div>
  );
}
