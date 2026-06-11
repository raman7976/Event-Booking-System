import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { apiError } from '../services/api.js';

export default function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authed') return <Navigate to={from} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(email, password);
      navigate(user.role === 'admin' && from === '/' ? '/admin' : from, { replace: true });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const quickFill = (e2, p2) => { setEmail(e2); setPassword(p2); setError(null); };

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-2xl border border-slate-700/60 bg-slate-800/80 p-8 shadow-xl">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-400">Sign in to book seats in real time.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-slate-300">Email</label>
            <input
              id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-slate-900 px-3 py-2.5 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-slate-300">Password</label>
            <input
              id="password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-900 px-3 py-2.5 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</div>
          )}

          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold transition hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 rounded-lg bg-slate-900/60 p-3 text-xs text-slate-400">
          <div className="mb-2 font-semibold uppercase tracking-wide text-slate-500">Demo accounts</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => quickFill('demo@demo.local', 'password123')}
              className="rounded bg-slate-700 px-2.5 py-1.5 text-slate-200 hover:bg-slate-600">
              Fill user
            </button>
            <button type="button" onClick={() => quickFill('admin@demo.local', 'Admin@1234')}
              className="rounded bg-purple-700/70 px-2.5 py-1.5 text-purple-100 hover:bg-purple-600/70">
              Fill admin
            </button>
          </div>
        </div>

        <p className="mt-5 text-center text-sm text-slate-400">
          No account? <Link to="/register" className="text-blue-400 hover:underline">Create one</Link>
        </p>
      </div>
    </div>
  );
}
