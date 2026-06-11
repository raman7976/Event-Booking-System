import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { myBookings } from '../services/api.js';
import CountdownTimer from '../components/CountdownTimer.jsx';

const STATUS_STYLE = {
  confirmed: 'bg-green-900/50 text-green-300',
  held: 'bg-amber-900/50 text-amber-300',
  expired: 'bg-slate-700 text-slate-400',
  cancelled: 'bg-slate-700 text-slate-400',
};

export default function MyBookingsPage() {
  const { data: bookings = [], isLoading, error, refetch } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: myBookings,
  });

  if (isLoading) return <p className="text-slate-400">Loading your bookings…</p>;
  if (error) return <p className="text-red-400">Failed to load bookings.</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold">My bookings</h1>

      {bookings.length === 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
          <p className="text-slate-300">You haven&apos;t booked anything yet.</p>
          <Link to="/" className="mt-3 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
            Browse events
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {bookings.map((b) => (
          <div key={b.reservationId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <div>
              <div className="font-semibold">{b.event.name}</div>
              <div className="text-sm text-slate-400">
                {b.event.venue} · {new Date(b.event.date).toLocaleString()}
              </div>
              <div className="mt-1 text-sm">
                Seat <b>{b.seat.row}{b.seat.number}</b> · {b.seat.category} · ${b.seat.price}
              </div>
            </div>
            <div className="text-right">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${STATUS_STYLE[b.status] || 'bg-slate-700'}`}>
                {b.status}
              </span>
              {b.status === 'held' && b.expiresAt && (
                <div className="mt-1.5 text-xs text-slate-400">
                  expires in <CountdownTimer expiresAt={b.expiresAt} onExpire={() => refetch()} />
                </div>
              )}
              {b.payment && (
                <div className="mt-1.5 text-xs text-slate-500">
                  ${b.payment.amount} · {b.payment.transactionId?.slice(0, 14)}…
                </div>
              )}
              <div className="mt-1.5">
                <Link to={`/events/${b.event.id}`} className="text-xs text-blue-400 hover:underline">View event →</Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
