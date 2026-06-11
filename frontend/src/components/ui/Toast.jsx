// App-wide toast notifications: useToast().push('Seat held!', 'success').
// Slide-in stack, auto-dismiss, pause-free and stateless for callers.
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const ToastCtx = createContext(null);

const STYLES = {
  success: { ring: 'ring-emerald-200', icon: '✓', iconBg: 'bg-emerald-100 text-emerald-700' },
  error: { ring: 'ring-rose-200', icon: '✕', iconBg: 'bg-rose-100 text-rose-700' },
  info: { ring: 'ring-violet-200', icon: 'ℹ', iconBg: 'bg-violet-100 text-violet-700' },
  live: { ring: 'ring-cyan-200', icon: '⚡', iconBg: 'bg-cyan-100 text-cyan-700' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((message, type = 'info', ttl = 4200) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, message, type }]);
    setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-20 z-[90] flex w-[min(92vw,360px)] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const s = STYLES[t.type] || STYLES.info;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 60, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl bg-white p-3 shadow-card ring-1 ${s.ring}`}
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.iconBg}`}>
                  {s.icon}
                </span>
                <p className="flex-1 text-sm leading-snug text-slate-700">{t.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="text-slate-400 transition hover:text-slate-700"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
