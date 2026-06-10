// Shows waitlist status / join-leave controls when an event is full.
export default function WaitlistBadge({ info, onJoin, onLeave, busy }) {
  if (!info) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-amber-700/40 bg-amber-900/30 p-3">
      <div className="text-sm text-amber-100">
        {info.onWaitlist ? (
          <>You&apos;re on the waitlist{info.position ? ` (position ${info.position} of ${info.size})` : ''}. We&apos;ll alert you the moment a seat frees up.</>
        ) : (
          <>This event is sold out. Join the waitlist ({info.size} waiting) to be notified.</>
        )}
      </div>
      {info.onWaitlist ? (
        <button type="button" onClick={onLeave} disabled={busy} className="ml-3 shrink-0 rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600 disabled:opacity-50">
          Leave
        </button>
      ) : (
        <button type="button" onClick={onJoin} disabled={busy} className="ml-3 shrink-0 rounded bg-amber-600 px-3 py-1 text-sm hover:bg-amber-500 disabled:opacity-50">
          Join waitlist
        </button>
      )}
    </div>
  );
}
