// Fake payment form. Validates card/expiry/CVV shape, shows a pay-by countdown,
// and calls onConfirm with the chosen method.
import { useState } from 'react';
import CountdownTimer from './CountdownTimer.jsx';

const formatCard = (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
const formatExp = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

export default function BookingModal({ seat, hold, onConfirm, onCancel, busy, error }) {
  const [card, setCard] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');

  const valid = card.replace(/\s/g, '').length >= 12 && /^\d{2}\/\d{2}$/.test(exp) && cvv.length >= 3;
  const submit = (e) => {
    e.preventDefault();
    if (valid && !busy) onConfirm('card');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold">Confirm booking</h2>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-900/60 p-3">
          <div>
            <div className="text-lg font-semibold">Seat {seat.row}{seat.number}</div>
            <div className="text-sm text-slate-400">{seat.category}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-green-400">${seat.price}</div>
            {hold?.expiresAt && (
              <div className="text-xs text-slate-400">
                hold expires in <CountdownTimer expiresAt={hold.expiresAt} />
              </div>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            value={card}
            onChange={(e) => setCard(formatCard(e.target.value))}
            placeholder="Card number"
            inputMode="numeric"
            className="w-full rounded bg-slate-900 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-3">
            <input
              value={exp}
              onChange={(e) => setExp(formatExp(e.target.value))}
              placeholder="MM/YY"
              className="w-1/2 rounded bg-slate-900 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={cvv}
              onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="CVV"
              className="w-1/2 rounded bg-slate-900 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <div className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</div>}
          <button
            type="submit"
            disabled={!valid || busy}
            className="w-full rounded bg-blue-600 py-2 font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Processing…' : `Pay $${seat.price}`}
          </button>
          <p className="text-center text-[11px] text-slate-500">Demo only — no real payment is processed.</p>
        </form>
      </div>
    </div>
  );
}
