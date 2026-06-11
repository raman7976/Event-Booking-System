// Password field with a show/hide toggle.
import { useState } from 'react';

export default function PasswordInput({ id, value, onChange, placeholder = '••••••••', autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        required
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="input-field pr-11"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 transition hover:text-slate-700"
      >
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}
