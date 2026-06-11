import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listEvents } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';

export default function EventsListPage() {
  const { isAdmin, status } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['events'], queryFn: () => listEvents(1, 50) });

  if (isLoading) return <p className="text-slate-400">Loading events…</p>;
  if (error) return <p className="text-red-400">Failed to load events.</p>;

  const events = data?.events || [];
  return (
    <div>
      <div className="mb-6 rounded-2xl border border-slate-700/60 bg-gradient-to-r from-blue-950/60 to-purple-950/40 p-6">
        <h1 className="text-3xl font-bold tracking-tight">Book seats in real time</h1>
        <p className="mt-1 max-w-xl text-sm text-slate-300">
          Live seat maps across every device — holds expire in 8 minutes, no two people can
          ever book the same seat{status !== 'authed' && <>. <Link to="/register" className="text-blue-300 underline">Create an account</Link> to start booking</>}.
        </p>
      </div>

      {events.length === 0 && (
        <p className="text-slate-400">No events yet — an admin can create one from the Admin panel.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((ev) => (
          <div key={ev.id} className="flex flex-col rounded-xl border border-slate-700 bg-slate-800 p-4 transition hover:border-slate-500">
            <div className="text-lg font-semibold">{ev.name}</div>
            <div className="text-sm text-slate-400">
              {ev.venue} · {new Date(ev.event_date).toLocaleDateString()}
            </div>
            <div className="mt-2 text-sm">
              <span className={ev.available_seats > 0 ? 'text-green-400' : 'text-red-400'}>
                {ev.available_seats > 0 ? `${ev.available_seats}/${ev.total_seats} available` : 'Sold out'}
              </span>
              {ev.base_price != null && <span className="text-slate-400"> · from ${ev.base_price}</span>}
            </div>
            <div className="mt-3 flex gap-2 pt-1">
              <Link to={`/events/${ev.id}`} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-500">
                {ev.available_seats > 0 ? 'Book seats' : 'View / waitlist'}
              </Link>
              {isAdmin && (
                <Link to={`/events/${ev.id}/dashboard`} className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">
                  Dashboard
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
