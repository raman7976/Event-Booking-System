import { useLocation, Link } from 'react-router-dom';

export default function ConfirmationPage() {
  const { state } = useLocation();
  const booking = state?.booking;

  if (!booking) {
    return (
      <div className="text-center">
        <p className="text-slate-400">No booking to show.</p>
        <Link to="/" className="text-blue-400 hover:underline">Back to events</Link>
      </div>
    );
  }

  const { seat, event, payment } = booking;
  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-xl border border-green-700/40 bg-green-900/20 p-6 text-center">
        <div className="text-5xl">✅</div>
        <h1 className="mt-2 text-2xl font-bold">Booking confirmed!</h1>
        <p className="text-slate-300">Seat {seat.row}{seat.number} ({seat.category}) is yours.</p>
      </div>

      <div className="mt-4 space-y-2 rounded-xl bg-slate-800 p-5 text-sm">
        <Row label="Event" value={event.name} />
        <Row label="Venue" value={event.venue} />
        <Row label="Date" value={new Date(event.date).toLocaleString()} />
        <Row label="Seat" value={`${seat.row}${seat.number} · ${seat.category}`} />
        <Row label="Amount paid" value={`$${payment.amount}`} />
        <Row label="Method" value={payment.method} />
        <Row label="Transaction" value={payment.transactionId} mono />
      </div>

      <div className="mt-4 flex gap-2">
        <Link to={`/events/${event.id}`} className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600">Back to seat map</Link>
        <Link to={`/events/${event.id}/dashboard`} className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500">View dashboard</Link>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  );
}
