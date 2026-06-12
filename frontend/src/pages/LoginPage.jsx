import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth.js';
import { apiError } from '../services/api.js';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import Icon from '../components/ui/Icon.jsx';

// One-tap demo credentials (seeded accounts) shown under the form.
const DEMO_ACCOUNTS = [
  ['user', 'Event user', 'demo@demo.local', 'password123'],
  ['bus', 'Campus student', '23ucs101@lnmiit.ac.in', 'Student@123'],
  ['shield', 'Admin', 'admin@demo.local', 'Admin@1234'],
];

export default function LoginPage() {
  const { login, status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';
  // Admins landing from nowhere specific go straight to their panel.
  const targetFor = (u) => (u?.role === 'admin' && from === '/' ? '/admin' : from);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Declarative + imperative redirects compute the SAME target, so whichever
  // wins the race after login() flips auth state, the destination is identical.
  if (status === 'authed') return <Navigate to={targetFor(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const loggedIn = await login(email, password);
      navigate(targetFor(loggedIn), { replace: true });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const quickFill = (e2, p2) => { setEmail(e2); setPassword(p2); setError(null); };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to book event seats and campus buses in real time.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
          <div className="relative">
            <Icon name="mail" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="input-field !pl-10" placeholder="you@lnmiit.ac.in"
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Institute emails get their roll number detected automatically.
          </p>
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
            <span className="text-[11px] text-slate-400">8+ chars · letter · number</span>
          </div>
          <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />{error}
          </motion.div>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
          {busy ? (
            <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Signing in…</>
          ) : <>Sign in <span aria-hidden="true">→</span></>}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-100" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Try the demo</span>
        <span className="h-px flex-1 bg-slate-100" />
      </div>

      <div className="space-y-2">
        {DEMO_ACCOUNTS.map(([icon, label, mail, pass]) => (
          <button
            key={mail}
            type="button"
            onClick={() => quickFill(mail, pass)}
            className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-slate-950 group-hover:text-white">
              <Icon name={icon} size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-slate-800">{label}</span>
              <span className="block truncate font-mono text-[11px] text-slate-400">{mail}</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 transition group-hover:text-slate-500">fill →</span>
          </button>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        New here? <Link to="/register" className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-900">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
