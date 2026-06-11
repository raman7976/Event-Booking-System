// Checkout sheet: spring-in glass modal with a live card preview that fills as
// you type, a draining countdown ring on the hold, and an animated pay button.
// (Demo payment — clearly labeled, nothing is charged.)
import { useState } from 'react';
import { motion } from 'framer-motion';
import ProgressRing from './ui/ProgressRing.jsx';
import Icon from './ui/Icon.jsx';

const formatCard = (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
const formatExp = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
const brandOf = (digits) =>
  digits.startsWith('4') ? 'VISA' : /^5[1-5]/.test(digits) ? 'MASTERCARD' : digits.startsWith('3') ? 'AMEX' : 'CARD';

export default function BookingModal({ seat, hold, onConfirm, onCancel, busy, error }) {
  const [card, setCard] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const digits = card.replace(/\s/g, '');

  const valid = digits.length >= 12 && /^\d{2}\/\d{2}$/.test(exp) && cvv.length >= 3;
  const submit = (e) => {
    e.preventDefault();
    if (valid && !busy) onConfirm('card');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: 42, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">Complete your booking</h2>
            <p className="text-xs text-slate-500">
              Seat <b className="text-slate-800">{seat.row}{seat.number}</b> · {seat.category}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hold?.expiresAt && (
              <ProgressRing expiresAt={hold.expiresAt} totalSeconds={hold.ttl || 480} size={48} />
            )}
            <button type="button" onClick={onCancel} aria-label="Close" className="text-slate-400 transition hover:rotate-90 hover:text-slate-800">
              ✕
            </button>
          </div>
        </div>

        <div className="p-6">
          {/* live card preview */}
          <div className="relative mb-5 h-44 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-indigo-800 p-5 shadow-glow-sm">
            <div className="absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/10 blur-md" aria-hidden="true" />
            <div className="flex items-start justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/70">SeatLive Pay · demo</span>
              <span className="font-display text-sm font-extrabold italic text-white/90">{brandOf(digits)}</span>
            </div>
            <div className="mt-7 font-mono text-xl tracking-[0.14em] text-white drop-shadow">
              {card || '•••• •••• •••• ••••'}
            </div>
            <div className="mt-5 flex justify-between font-mono text-xs text-white/85">
              <span>{exp || 'MM/YY'}</span>
              <span>{cvv ? '•'.repeat(cvv.length) : 'CVV'}</span>
              <span className="font-sans font-semibold">${seat.price}</span>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              value={card}
              onChange={(e) => setCard(formatCard(e.target.value))}
              placeholder="Card number"
              inputMode="numeric"
              autoFocus
              className="input-field font-mono"
            />
            <div className="flex gap-3">
              <input value={exp} onChange={(e) => setExp(formatExp(e.target.value))} placeholder="MM/YY" className="input-field font-mono" />
              <input
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="CVV"
                type="password"
                className="input-field font-mono"
              />
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {error}
              </motion.div>
            )}

            <button type="submit" disabled={!valid || busy} className="btn-primary w-full py-3">
              {busy ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Processing…
                </>
              ) : (
                <><Icon name="lock" size={15} /> Pay ${seat.price}</>
              )}
            </button>
            <p className="text-center text-[11px] text-slate-400">
              Demo checkout — no real payment is processed. Hold auto-releases if you don&apos;t finish in time.
            </p>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}
