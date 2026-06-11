import { useCallback, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth.js';
import {
  getEvent, recommend as apiRecommend,
  joinWaitlist, leaveWaitlist, getWaitlist, apiError,
} from '../services/api.js';
import { useSeats } from '../hooks/useSeats.js';
import { useBooking } from '../hooks/useBooking.js';
import SeatMap from '../components/SeatMap.jsx';
import SeatLegend from '../components/SeatLegend.jsx';
import BookingModal from '../components/BookingModal.jsx';
import WaitlistBadge from '../components/WaitlistBadge.jsx';

const PREFS = ['together', 'aisle', 'front', 'back'];

export default function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { status: authStatus, isAdmin } = useAuth();

  // Booking requires a signed-in user; browsing doesn't.
  const requireLogin = () => {
    navigate('/login', { state: { from: location } });
  };

  const [notice, setNotice] = useState(null);
  const onWaitlistAvailable = useCallback(
    () => setNotice({ type: 'good', msg: '🎉 A seat just opened up for you — grab it now!' }),
    [],
  );

  const { data: eventData } = useQuery({ queryKey: ['event', id], queryFn: () => getEvent(id), enabled: Boolean(id) });
  const { data: seats = [], isLoading } = useSeats(id, { onWaitlistAvailable });
  const { hold, release, confirm, busy } = useBooking(id);

  const [holdsBySeat, setHoldsBySeat] = useState({}); // seatId -> { holdToken, expiresAt }
  const [modalSeat, setModalSeat] = useState(null);
  const [confirmError, setConfirmError] = useState(null);

  // Smart Recommend form
  const [groupSize, setGroupSize] = useState(2);
  const [budget, setBudget] = useState('');
  const [prefs, setPrefs] = useState(new Set(['together']));
  const [rec, setRec] = useState(null);
  const [recBusy, setRecBusy] = useState(false);

  const event = eventData?.event;
  const soldOut = seats.length > 0 && seats.every((s) => s.status !== 'available');
  const { data: waitlistInfo, refetch: refetchWaitlist } = useQuery({
    queryKey: ['waitlist', id], queryFn: () => getWaitlist(id), enabled: Boolean(id),
  });
  const [wlBusy, setWlBusy] = useState(false);

  const togglePref = (p) =>
    setPrefs((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const onSeatClick = async (seat) => {
    if (authStatus !== 'authed') return requireLogin();
    setConfirmError(null);
    if (seat.heldByMe && holdsBySeat[seat.id]) { setModalSeat(seat); return; }
    try {
      const res = await hold(seat.id);
      setHoldsBySeat((h) => ({ ...h, [seat.id]: { holdToken: res.holdToken, expiresAt: res.expiresAt } }));
      setModalSeat(seat);
    } catch (err) {
      setNotice({ type: 'bad', msg: apiError(err) });
    }
  };

  const onHoldExpire = (seatId) =>
    setHoldsBySeat((h) => { const n = { ...h }; delete n[seatId]; return n; });

  const doConfirm = async (method) => {
    const heldInfo = holdsBySeat[modalSeat.id];
    if (!heldInfo) return;
    setConfirmError(null);
    try {
      const booking = await confirm(heldInfo.holdToken, method);
      setHoldsBySeat((h) => { const n = { ...h }; delete n[modalSeat.id]; return n; });
      setModalSeat(null);
      navigate('/confirmation', { state: { booking } });
    } catch (err) {
      setConfirmError(apiError(err));
    }
  };

  const runRecommend = async (e) => {
    e.preventDefault();
    setRecBusy(true);
    setRec(null);
    try {
      const payload = { eventId: id, groupSize: Number(groupSize), preferences: [...prefs] };
      if (budget) payload.maxBudget = Number(budget);
      setRec(await apiRecommend(payload));
    } catch (err) {
      setNotice({ type: 'bad', msg: apiError(err) });
    } finally {
      setRecBusy(false);
    }
  };

  // One-click hold of all recommended seats; compensating release on partial failure.
  const holdRecommended = async () => {
    if (authStatus !== 'authed') return requireLogin();
    if (!rec?.recommendedSeatIds?.length) return;
    const held = [];
    try {
      for (const seatId of rec.recommendedSeatIds) {
        const res = await hold(seatId);
        held.push({ seatId, holdToken: res.holdToken, expiresAt: res.expiresAt });
      }
      setHoldsBySeat((h) => {
        const n = { ...h };
        held.forEach((x) => { n[x.seatId] = { holdToken: x.holdToken, expiresAt: x.expiresAt }; });
        return n;
      });
      setNotice({ type: 'good', msg: `Held ${held.length} seat(s). Click any blue seat to pay.` });
      setRec(null);
    } catch (err) {
      for (const x of held) await release(x.seatId, x.holdToken); // roll back
      setNotice({ type: 'bad', msg: `Couldn't hold all seats (${apiError(err)}). Released the partial hold.` });
    }
  };

  const doJoinWaitlist = async () => {
    if (authStatus !== 'authed') return requireLogin();
    setWlBusy(true);
    try { await joinWaitlist(id); await refetchWaitlist(); } catch (err) { setNotice({ type: 'bad', msg: apiError(err) }); } finally { setWlBusy(false); }
  };
  const doLeaveWaitlist = async () => {
    setWlBusy(true);
    try { await leaveWaitlist(id); await refetchWaitlist(); } catch { /* ignore */ } finally { setWlBusy(false); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to="/" className="text-sm text-slate-400 hover:underline">← All events</Link>
          <h1 className="text-2xl font-bold">{event?.name || 'Event'}</h1>
          {event && <p className="text-sm text-slate-400">{event.venue} · {new Date(event.event_date).toLocaleString()}</p>}
        </div>
        {isAdmin && (
          <Link to={`/events/${id}/dashboard`} className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">Dashboard →</Link>
        )}
      </div>

      {notice && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${notice.type === 'good' ? 'bg-green-900/30 text-green-200' : 'bg-red-900/30 text-red-200'}`}>
          <div className="flex justify-between">
            <span>{notice.msg}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-slate-400">✕</button>
          </div>
        </div>
      )}

      {/* Smart Recommend */}
      <form onSubmit={runRecommend} className="mb-4 rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400">Group size</label>
            <input type="number" min="1" max="20" value={groupSize} onChange={(e) => setGroupSize(e.target.value)} className="w-20 rounded bg-slate-900 px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Max budget ($)</label>
            <input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="any" className="w-24 rounded bg-slate-900 px-2 py-1" />
          </div>
          <div className="flex flex-wrap gap-2">
            {PREFS.map((p) => (
              <label key={p} className={`cursor-pointer rounded px-2 py-1 text-sm ${prefs.has(p) ? 'bg-blue-600' : 'bg-slate-900'}`}>
                <input type="checkbox" className="mr-1 align-middle" checked={prefs.has(p)} onChange={() => togglePref(p)} />
                {p}
              </label>
            ))}
          </div>
          <button type="submit" disabled={recBusy} className="rounded bg-purple-600 px-4 py-2 text-sm font-semibold hover:bg-purple-500 disabled:opacity-50">
            {recBusy ? 'Thinking…' : '✨ Smart Recommend'}
          </button>
        </div>

        {rec && (
          <div className="mt-3 rounded-lg bg-slate-900/70 p-3">
            <div className="rounded bg-purple-900/40 px-3 py-2 text-purple-100">{rec.reason}</div>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
              <span>{rec.recommendedSeatIds.length} seat(s) · source: <b className="text-slate-200">{rec.source}{rec.model ? ` (${rec.model})` : ''}</b></span>
              {rec.recommendedSeatIds.length > 0 && (
                <button type="button" onClick={holdRecommended} className="rounded bg-green-600 px-3 py-1.5 font-semibold hover:bg-green-500">
                  Hold these seats
                </button>
              )}
            </div>
          </div>
        )}
      </form>

      {soldOut && (
        <div className="mb-4">
          <WaitlistBadge info={waitlistInfo} onJoin={doJoinWaitlist} onLeave={doLeaveWaitlist} busy={wlBusy} />
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="mb-3"><SeatLegend /></div>
        {isLoading ? (
          <p className="py-10 text-center text-slate-400">Loading seats…</p>
        ) : (
          <SeatMap seats={seats} onSeatClick={onSeatClick} holdsBySeat={holdsBySeat} onHoldExpire={onHoldExpire} />
        )}
      </div>

      {modalSeat && (
        <BookingModal
          seat={modalSeat}
          hold={holdsBySeat[modalSeat.id]}
          onConfirm={doConfirm}
          onCancel={() => setModalSeat(null)}
          busy={busy}
          error={confirmError}
        />
      )}
    </div>
  );
}
