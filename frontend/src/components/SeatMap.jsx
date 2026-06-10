// Seat grid grouped by row with the exact status color coding. Available seats
// (and the user's own holds) are clickable; WebSocket updates re-color instantly.
import { useMemo } from 'react';
import CountdownTimer from './CountdownTimer.jsx';

function colorFor(seat) {
  if (seat.status === 'booked') return '#ef4444';
  if (seat.status === 'held') return seat.heldByMe ? '#3b82f6' : '#eab308';
  if (seat.status === 'available') return '#22c55e';
  return '#6b7280';
}

export default function SeatMap({ seats = [], onSeatClick, holdsBySeat = {}, onHoldExpire }) {
  const rows = useMemo(() => {
    const m = {};
    for (const s of seats) (m[s.row] ||= []).push(s);
    for (const r of Object.keys(m)) m[r].sort((a, b) => a.number - b.number);
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [seats]);

  if (!seats.length) return <div className="text-slate-400 text-center py-10">No seats for this event.</div>;

  return (
    <div className="space-y-2">
      <div className="mx-auto mb-4 w-2/3 rounded bg-slate-700/60 py-1 text-center text-xs uppercase tracking-[0.3em] text-slate-300">
        Stage
      </div>
      {rows.map(([row, list]) => (
        <div key={row} className="flex items-center justify-center gap-2">
          <span className="w-6 text-right text-sm text-slate-400">{row}</span>
          <div className="flex flex-wrap justify-center gap-1.5">
            {list.map((seat) => {
              const clickable = seat.status === 'available' || seat.heldByMe;
              const hold = holdsBySeat[seat.id];
              return (
                <button
                  key={seat.id}
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onSeatClick?.(seat)}
                  title={`${seat.row}${seat.number} · ${seat.category} · $${seat.price} · ${seat.heldByMe ? 'your hold' : seat.status}`}
                  className={`flex h-9 w-9 items-center justify-center rounded text-[10px] font-semibold text-white transition ${
                    clickable ? 'cursor-pointer hover:scale-110' : 'cursor-not-allowed opacity-90'
                  }`}
                  style={{ background: colorFor(seat) }}
                >
                  {seat.heldByMe && hold ? (
                    <CountdownTimer expiresAt={hold.expiresAt} onExpire={() => onHoldExpire?.(seat.id)} className="text-[9px]" />
                  ) : (
                    seat.number
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
