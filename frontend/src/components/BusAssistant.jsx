// Floating "Campus Bus Assistant" chat widget (read-only agentic RAG). Shown to
// campus riders; asks POST /api/bus/assistant and renders the answer + cited
// policy sources. Keeps a short history so follow-ups have context.
import { useEffect, useRef, useState } from 'react';
import { busAssistantAsk, apiError } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';

const SUGGESTIONS = [
  'Next bus to Raja Park?',
  'What is the no-show policy?',
  'Am I on any waitlist?',
];

export default function BusAssistant() {
  const { status, isCampus, hasRoll } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role:'user'|'assistant', content, sources?}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  if (status !== 'authed' || !isCampus || !hasRoll) return null;

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const res = await busAssistantAsk(message, history.slice(-8));
      setMessages((m) => [...m, { role: 'assistant', content: res.answer || '…', sources: res.sources || [] }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Sorry — ${apiError(err)}`, sources: [] }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Campus bus assistant"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 text-white shadow-lg transition-transform hover:scale-105"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3 6.6 3 11c0 2.1.9 4 2.5 5.4L5 21l4.2-1.6c.9.2 1.8.3 2.8.3 5 0 9-3.6 9-8s-4-8-9-8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-40 flex h-[30rem] w-[92vw] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <div>
              <div className="text-sm font-bold text-slate-800">Bus assistant</div>
              <div className="text-[11px] text-slate-400">Schedules, bookings & policy · read-only</div>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-500">Ask me about today's buses, your bookings, or the rules.</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {m.content}
                </div>
                {m.sources?.length > 0 && (
                  <div className="mt-1 text-[10px] text-slate-400">
                    Sources: {m.sources.map((s) => s.title || s.source).join(', ')}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="text-left text-sm text-slate-400">Thinking…</div>}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="flex items-center gap-2 border-t border-slate-100 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about buses…"
              className="flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <button type="submit" disabled={busy || !input.trim()} className="btn-primary !px-4 !py-2 text-sm disabled:opacity-50">
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
