// Access banners for the bus vertical:
//   guest                -> sign-in prompt
//   non-campus account   -> domain notice
//   campus without roll  -> inline set-once roll-number form
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from './ui/Toast.jsx';
import { apiError } from '../services/api.js';

export default function RollNumberGate() {
  const { status, isCampus, hasRoll, updateRollNumber } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [roll, setRoll] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return null;

  if (status !== 'authed') {
    return (
      <div className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-slate-600">
          🚌 The campus bus service is free for LNMIIT students —{' '}
          <b className="text-slate-900">sign in with your @lnmiit.ac.in account</b> to book a seat.
        </p>
        <Link to="/login" state={{ from: location }} className="btn-primary !py-2 text-xs">Sign in</Link>
      </div>
    );
  }

  if (!isCampus) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        ⚠️ Bus booking needs an <b>@lnmiit.ac.in</b> account. You can browse the live schedule,
        but create/sign in with your institute email to book.
      </div>
    );
  }

  if (!hasRoll) {
    const submit = async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await updateRollNumber(roll.trim());
        toast.push('Roll number saved — you can book seats now.', 'success');
      } catch (err) {
        toast.push(apiError(err), 'error', 6000);
      } finally {
        setBusy(false);
      }
    };
    return (
      <form onSubmit={submit} className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-slate-600">
          🎓 One last step — add your <b className="text-slate-900">roll number</b> (it identifies you
          on the manifest and the public waitlist).
        </p>
        <div className="flex gap-2">
          <input
            value={roll}
            onChange={(e) => setRoll(e.target.value.toUpperCase())}
            placeholder="e.g. 23UCS101"
            required
            minLength={4}
            maxLength={20}
            className="input-field !w-40 !py-2 font-mono text-xs"
          />
          <button type="submit" disabled={busy} className="btn-primary !py-2 text-xs">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    );
  }

  return null;
}
