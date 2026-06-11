// Admin panel: cross-event overview, event management table, and a
// create-event form with a dynamic section builder (rows × cols × price).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listEvents, adminOverview, adminCreateEvent, adminDeleteEvent, apiError,
} from '../services/api.js';

const emptySection = () => ({ rows: 'A,B', cols: 8, category: 'GENERAL', price: 50 });

export default function AdminPage() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState(null);

  const { data: overview } = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminOverview });
  const { data: eventsData, isLoading } = useQuery({ queryKey: ['events'], queryFn: () => listEvents(1, 100) });

  const createMut = useMutation({
    mutationFn: adminCreateEvent,
    onSuccess: ({ event }) => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      setNotice({ type: 'good', msg: `Created "${event.name}" with ${event.total_seats} seats.` });
    },
    onError: (err) => setNotice({ type: 'bad', msg: apiError(err) }),
  });

  const deleteMut = useMutation({
    mutationFn: adminDeleteEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      setNotice({ type: 'good', msg: 'Event deleted.' });
    },
    onError: (err) => setNotice({ type: 'bad', msg: apiError(err) }),
  });

  // ── create form state ──
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [sections, setSections] = useState([emptySection()]);

  const updateSection = (i, patch) =>
    setSections((s) => s.map((sec, j) => (j === i ? { ...sec, ...patch } : sec)));

  const submit = (e) => {
    e.preventDefault();
    setNotice(null);
    createMut.mutate({
      name: name.trim(),
      venue: venue.trim(),
      eventDate: new Date(date).toISOString(),
      layout: sections.map((s) => ({ ...s, cols: Number(s.cols), price: Number(s.price) })),
    });
  };

  const events = eventsData?.events || [];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Admin panel</h1>

      {notice && (
        <div className={`mb-4 flex justify-between rounded-lg px-3 py-2 text-sm ${notice.type === 'good' ? 'bg-green-900/30 text-green-200' : 'bg-red-900/30 text-red-200'}`}>
          <span>{notice.msg}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-slate-400">✕</button>
        </div>
      )}

      {/* overview */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Events" value={overview?.events ?? '—'} />
        <Stat label="Users" value={overview?.users ?? '—'} />
        <Stat label="Seats sold" value={overview != null ? `${overview.seatsSold}/${overview.totalSeats}` : '—'} />
        <Stat label="Bookings" value={overview?.confirmedBookings ?? '—'} />
        <Stat label="Revenue" value={overview != null ? `$${overview.revenue}` : '—'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* events table */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 lg:col-span-3">
          <h2 className="mb-3 font-semibold">Events</h2>
          {isLoading ? (
            <p className="text-slate-400">Loading…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="py-2 pr-2 font-medium">Event</th>
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 pr-2 font-medium">Seats</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-b border-slate-700/50">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{ev.name}</div>
                      <div className="text-xs text-slate-400">{ev.venue}</div>
                    </td>
                    <td className="py-2 pr-2 text-slate-300">{new Date(ev.event_date).toLocaleDateString()}</td>
                    <td className="py-2 pr-2 text-slate-300">{ev.available_seats}/{ev.total_seats}</td>
                    <td className="py-2">
                      <div className="flex gap-1.5">
                        <Link to={`/events/${ev.id}/dashboard`} className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">Dashboard</Link>
                        <Link to={`/events/${ev.id}`} className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">Seats</Link>
                        <button
                          type="button"
                          onClick={() => deleteMut.mutate(ev.id)}
                          disabled={deleteMut.isPending}
                          className="rounded bg-red-900/60 px-2 py-1 text-xs text-red-200 hover:bg-red-800/60 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-slate-500">No events yet — create one →</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* create form */}
        <form onSubmit={submit} className="rounded-xl border border-slate-700 bg-slate-800 p-4 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Create event</h2>
          <div className="space-y-3">
            <input
              required value={name} onChange={(e) => setName(e.target.value)} placeholder="Event name"
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <input
              required value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue"
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <input
              required type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            />

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">Seat sections</div>
              {sections.map((sec, i) => (
                <div key={i} className="rounded-lg bg-slate-900/70 p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-400">
                      Rows (comma sep)
                      <input value={sec.rows} onChange={(e) => updateSection(i, { rows: e.target.value })}
                        className="mt-0.5 w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700" />
                    </label>
                    <label className="text-xs text-slate-400">
                      Seats per row
                      <input type="number" min="1" max="50" value={sec.cols} onChange={(e) => updateSection(i, { cols: e.target.value })}
                        className="mt-0.5 w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700" />
                    </label>
                    <label className="text-xs text-slate-400">
                      Category
                      <select value={sec.category} onChange={(e) => updateSection(i, { category: e.target.value })}
                        className="mt-0.5 w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700">
                        <option>VIP</option><option>PREMIUM</option><option>GENERAL</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-400">
                      Price ($)
                      <input type="number" min="1" value={sec.price} onChange={(e) => updateSection(i, { price: e.target.value })}
                        className="mt-0.5 w-full rounded bg-slate-900 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700" />
                    </label>
                  </div>
                  {sections.length > 1 && (
                    <button type="button" onClick={() => setSections((s) => s.filter((_, j) => j !== i))}
                      className="mt-2 text-xs text-red-300 hover:underline">
                      Remove section
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setSections((s) => [...s, emptySection()])}
                className="rounded bg-slate-700 px-2.5 py-1.5 text-xs hover:bg-slate-600">
                + Add section
              </button>
            </div>

            <button
              type="submit" disabled={createMut.isPending}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
            >
              {createMut.isPending ? 'Creating…' : 'Create event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
