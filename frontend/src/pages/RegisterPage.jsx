import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth.js';
import { apiError, apiFieldErrors } from '../services/api.js';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

const RULES = [
  ['8+ characters', (pw) => pw.length >= 8],
  ['a letter', (pw) => /[A-Za-z]/.test(pw)],
  ['a number', (pw) => /[0-9]/.test(pw)],
];

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

  const ruleState = RULES.map(([label, test]) => [label, test(password)]);
  const pwOk = ruleState.every(([, ok]) => ok);
  const mismatch = confirm && confirm !== password;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors(null);
    if (!pwOk || mismatch) return;
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
    <AuthLayout title="Create your account" subtitle="Browse free — sign up to hold & book seats.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-300">Name</label>
          <input
            id="name" required maxLength={100} value={name}
            onChange={(e) => setName(e.target.value)} autoComplete="name"
            className="input-field" placeholder="Ada Lovelace"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
          <input
            id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            className="input-field" placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-300">Password</label>
          <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Create a strong password" />
          {password && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ruleState.map(([label, ok]) => (
                <span
                  key={label}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-500'
                  }`}
                >
                  {ok ? '✓' : '○'} {label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-slate-300">Confirm password</label>
          <PasswordInput id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Repeat it" />
          {mismatch && <p className="mt-1.5 text-xs text-amber-300">Passwords don&apos;t match.</p>}
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
          >
            {error}
            {fieldErrors && (
              <ul className="mt-1 list-inside list-disc text-xs">
                {fieldErrors.map((f) => <li key={f.field}>{f.field}: {f.message}</li>)}
              </ul>
            )}
          </motion.div>
        )}

        <button type="submit" disabled={busy || !pwOk || Boolean(mismatch)} className="btn-primary w-full !py-3">
          {busy ? (
            <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Creating account…</>
          ) : 'Create account →'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        Already registered? <Link to="/login" className="font-medium text-violet-300 hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
