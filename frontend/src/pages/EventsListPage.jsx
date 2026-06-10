import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listEvents } from '../services/api.js';

export default function EventsListPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['events'], queryFn: () => listEvents(1, 50) });

  if (isLoading) return <p className="text-slate-400">Loading events…</p>;
  if (error) return <p className="text-red-400">Failed to load events.</p>;

  const events = data?.events || [];
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Upcoming events</h1>
      {events.length === 0 && <p className="text-slate-400">No events yet — run <code>npm run seed</code> in the backend.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((ev) => (
          <div key={ev.id} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <div className="text-lg font-semibold">{ev.name}</div>
            <div className="text-sm text-slate-400">
              {ev.venue} · {new Date(ev.event_date).toLocaleDateString()}
            </div>
            <div className="mt-2 text-sm">
              <span className={ev.available_seats > 0 ? 'text-green-400' : 'text-red-400'}>
                {ev.available_seats}/{ev.total_seats} available
              </span>
              {ev.base_price != null && <> · from ${ev.base_price}</>}
            </div>
            <div className="mt-3 flex gap-2">
              <Link to={`/events/${ev.id}`} className="rounded bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500">
                Book seats
              </Link>
              <Link to={`/events/${ev.id}/dashboard`} className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">
                Dashboard
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
