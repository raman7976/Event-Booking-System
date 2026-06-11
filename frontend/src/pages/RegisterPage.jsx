import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { apiError, apiFieldErrors } from '../services/api.js';

const passwordIssues = (pw) => {
  const issues = [];
  if (pw.length < 8) issues.push('at least 8 characters');
  if (!/[A-Za-z]/.test(pw)) issues.push('a letter');
  if (!/[0-9]/.test(pw)) issues.push('a number');
  return issues;
};

export default function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authed') return <Navigate to="/" replace />;

  const pwIssues = password ? passwordIssues(password) : [];
  const mismatch = confirm && confirm !== password;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors(null);
    if (pwIssues.length || mismatch) return;
    setBusy(true);
    try {
      await register(name.trim(), email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(apiError(err));
      setFieldErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-2xl border border-slate-700/60 bg-slate-800/80 p-8 shadow-xl">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-400">Browse free — sign up to hold &amp; book seats.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="name" className="mb-1 block text-sm text-slate-300">Name</label>
            <input
              id="name" required maxLength={100} value={name}
              onChange={(e) => setName(e.target.value)} autoComplete="name"
              className="w-full rounded-lg bg-slate-900 px-3 py-2.5 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
              placeholder="Ada Lovelace"
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-slate-300">Email</label>
            <input
              id="email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              className="w-full rounded-lg bg-slate-900 px-3 py-2.5 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-slate-300">Password</label>
            <input
              id="password" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              className="w-full rounded-lg bg-slate-900 px-3 py-2.5 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
              placeholder="min 8 chars, letter + number"
            />
            {pwIssues.length > 0 && (
              <p className="mt-1 text-xs text-amber-300">Needs {pwIssues.join(', ')}.</p>
            )}
          </div>
          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm text-slate-300">Confirm password</label>
            <input
              id="confirm" type="password" required value={confirm}
              onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
              className="w-full rounded-lg bg-slate-900 px-3 py-2.5 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
            />
            {mismatch && <p className="mt-1 text-xs text-amber-300">Passwords don&apos;t match.</p>}
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">
              {error}
              {fieldErrors && (
                <ul className="mt-1 list-inside list-disc text-xs">
                  {fieldErrors.map((f) => <li key={f.field}>{f.field}: {f.message}</li>)}
                </ul>
              )}
            </div>
          )}

          <button
            type="submit" disabled={busy || pwIssues.length > 0 || mismatch}
            className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold transition hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-400">
          Already registered? <Link to="/login" className="text-blue-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
