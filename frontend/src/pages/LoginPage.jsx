import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth.js';
import { apiError } from '../services/api.js';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

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
    <AuthLayout title="Welcome back" subtitle="Sign in to hold and book seats in real time.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
          <input
            id="email" type="email" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="input-field" placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
          <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </motion.div>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
          {busy ? (
            <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Signing in…</>
          ) : 'Sign in →'}
        </button>
      </form>

      <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-3.5">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Try the demo</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => quickFill('demo@demo.local', 'password123')} className="btn-ghost flex-1 !py-2 text-xs">
            👤 User account
          </button>
          <button
            type="button" onClick={() => quickFill('admin@demo.local', 'Admin@1234')}
            className="flex-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 transition hover:bg-violet-100"
          >
            👑 Admin account
          </button>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        New here? <Link to="/register" className="font-medium text-violet-700 hover:underline">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
