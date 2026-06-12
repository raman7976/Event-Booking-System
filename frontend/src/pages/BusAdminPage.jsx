// Transport admin: timetable CRUD (capacity / active / add / delete), holiday
// calendar, regeneration, and per-trip manifests for today.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  busAdminSchedules, busAdminCreateSchedule, busAdminUpdateSchedule, busAdminDeleteSchedule,
  busAdminHolidays, busAdminAddHoliday, busAdminRemoveHoliday,
  busAdminManifest, busAdminGenerate, busSchedule, apiError,
  busAdminFlags, busAdminAnalyzeFlags, busAdminCapacityAdvice,
} from '../services/api.js';
import { useToast } from '../components/ui/Toast.jsx';
import Icon from '../components/ui/Icon.jsx';

const WD = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const hhmm = (t) => t?.slice(0, 5);

const TIER_CHIP = {
  high: 'border-rose-200 bg-rose-50 text-rose-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-slate-200 bg-slate-50 text-slate-500',
};
const ACTION_LABEL = { none: 'no action', warn: 'send warning', cooldown: 'booking cooldown' };
const REC_CHIP = {
  increase: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  decrease: 'border-amber-200 bg-amber-50 text-amber-700',
  keep: 'border-slate-200 bg-slate-50 text-slate-500',
};

const SourceChip = ({ source, model }) => (
  <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
    {source}{model ? ` · ${model}` : ''}
  </span>
);

// AI ops: rider reliability flags ("books but doesn't board")
function RiderFlagsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: flags = [] } = useQuery({ queryKey: ['bus-rider-flags'], queryFn: busAdminFlags });
  const analyze = useMutation({
    mutationFn: busAdminAnalyzeFlags,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['bus-rider-flags'] });
      toast.push(
        r.flags.length
          ? `Analyzed riders — ${r.flags.length} flagged (${r.source}).`
          : 'No riders meet the flagging threshold.',
        'success',
      );
    },
    onError: (err) => toast.push(apiError(err), 'error', 6000),
  });
  const src = flags[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
      className={`glass relative overflow-hidden p-5 ${analyze.isPending ? 'ring-2 ring-violet-300/70' : ''}`}
    >
      {analyze.isPending && (
        <motion.div
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-blue-400"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
        />
      )}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50">
            <Icon name="sparkles" size={17} className="text-violet-600" />
          </span>
          <div>
            <h2 className="font-display font-bold text-slate-900">Rider reliability</h2>
            <p className="text-[11px] text-slate-400">flags riders who book seats but don&apos;t board · advisory only</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {src && <SourceChip source={src.source} model={src.model} />}
          <button
            type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending}
            className="btn-primary !py-1.5 text-xs"
          >
            {analyze.isPending ? 'Analyzing…' : 'Analyze riders'}
          </button>
        </div>
      </div>

      {flags.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          No flags yet — run an analysis. Riders with ≥3 bookings and ≥1 miss in the last 30 days are scored.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {flags.map((f) => (
            <li key={f.userId} className="rounded-xl border border-slate-100 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-slate-700">{f.rollNumber || '—'}</span>
                <span className="text-sm font-medium text-slate-900">{f.name}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TIER_CHIP[f.tier]}`}>
                  {f.tier} risk
                </span>
                <span className="ml-auto rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {ACTION_LABEL[f.action]}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
                <span className="chip !px-2 !py-0.5">{f.stats.total} booked</span>
                <span className="chip !px-2 !py-0.5 !text-rose-600">{f.stats.misses} missed</span>
                {f.stats.blockedWaiters > 0 && (
                  <span className="chip !px-2 !py-0.5 !text-amber-700">{f.stats.blockedWaiters} blocked waiters</span>
                )}
                <span className="chip !px-2 !py-0.5">{Math.round((f.stats.missRate || 0) * 100)}% miss rate</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{f.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

// AI ops: per-route capacity recommendations with one-click apply.
function CapacityAdvisorCard({ onApply, busyId }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const advise = useMutation({
    mutationFn: busAdminCapacityAdvice,
    onSuccess: (r) => {
      setResult(r);
      toast.push(r.advice.length ? `Advice ready for ${r.advice.length} route(s) (${r.source}).` : 'No departed trips to analyze yet.', 'success');
    },
    onError: (err) => toast.push(apiError(err), 'error', 6000),
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}
      className={`glass relative overflow-hidden p-5 ${advise.isPending ? 'ring-2 ring-violet-300/70' : ''}`}
    >
      {advise.isPending && (
        <motion.div
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-blue-400"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
        />
      )}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50">
            <Icon name="chart" size={17} className="text-violet-600" />
          </span>
          <div>
            <h2 className="font-display font-bold text-slate-900">Capacity advisor</h2>
            <p className="text-[11px] text-slate-400">demand analysis over recent trips · apply suggestions in one click</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && <SourceChip source={result.source} model={result.model} />}
          <button
            type="button" onClick={() => advise.mutate()} disabled={advise.isPending}
            className="btn-primary !py-1.5 text-xs"
          >
            {advise.isPending ? 'Analyzing…' : 'Get advice'}
          </button>
        </div>
      </div>

      {!result ? (
        <p className="mt-3 text-sm text-slate-400">
          Analyzes fill rates, waitlist pressure and time-to-full across departed trips, per timetable row.
        </p>
      ) : result.advice.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No departed trips in the window yet.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {result.advice.map((a) => (
            <li key={a.scheduleId} className="rounded-xl border border-slate-100 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-bold text-slate-900">
                  Bus {a.busNo} · {a.departureTime}
                </span>
                <span className="text-xs text-slate-500">{a.origin} → {a.destination}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${REC_CHIP[a.recommendation]}`}>
                  {a.recommendation}
                </span>
                {a.recommendation !== 'keep' && a.suggestedCapacity && a.suggestedCapacity !== a.capacity && (
                  <button
                    type="button"
                    disabled={busyId === a.scheduleId}
                    onClick={() => onApply(a.scheduleId, a.suggestedCapacity)}
                    className="ml-auto btn-ghost !rounded-lg !px-2.5 !py-1 text-[11px]"
                  >
                    {busyId === a.scheduleId ? 'Applying…' : `Apply ${a.capacity} → ${a.suggestedCapacity}`}
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
                <span className="chip !px-2 !py-0.5">{a.trips} trips</span>
                <span className="chip !px-2 !py-0.5">{Math.round((a.avgFill || 0) * 100)}% avg fill</span>
                <span className="chip !px-2 !py-0.5">peak {a.peakBooked}/{a.capacity}</span>
                {a.avgWaitlist > 0 && <span className="chip !px-2 !py-0.5 !text-amber-700">~{a.avgWaitlist} waiting</span>}
                {a.avgMinutesToFull != null && <span className="chip !px-2 !py-0.5">full in ~{Math.round(a.avgMinutesToFull)}m</span>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{a.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

function ScheduleTable({ rows, onPatch, onDelete, busyId }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-400">
          <th className="py-2 pr-2 font-medium">Bus</th>
          <th className="py-2 pr-2 font-medium">Route</th>
          <th className="py-2 pr-2 font-medium">Time</th>
          <th className="py-2 pr-2 font-medium">Days</th>
          <th className="py-2 pr-2 font-medium">Capacity</th>
          <th className="py-2 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id} className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${!s.active ? 'opacity-45' : ''}`}>
            <td className="py-2.5 pr-2 font-display font-bold text-slate-900">{s.bus_no}</td>
            <td className="py-2.5 pr-2 text-slate-700">{s.origin} → {s.destination}</td>
            <td className="py-2.5 pr-2 font-mono text-slate-700">{hhmm(s.departure_time)}</td>
            <td className="py-2.5 pr-2 text-xs text-slate-500">
              {s.pattern === 'weekend_holiday' ? 'Sat/Sun/Hol' : s.weekday_only ? `${WD[s.weekday_only]} only` : 'Mon–Fri'}
            </td>
            <td className="py-2.5 pr-2">
              <input
                key={`${s.id}-${s.capacity}`} // remount when capacity changes elsewhere (uncontrolled input)
                type="number" min="1" max="100" defaultValue={s.capacity}
                onBlur={(e) => Number(e.target.value) !== s.capacity && onPatch(s.id, { capacity: Number(e.target.value) })}
                className="input-field !w-16 !px-2 !py-1 text-xs"
              />
            </td>
            <td className="py-2.5">
              <div className="flex gap-1.5">
                <button
                  type="button" disabled={busyId === s.id}
                  onClick={() => onPatch(s.id, { active: !s.active })}
                  className="btn-ghost !rounded-lg !px-2 !py-1 text-[11px]"
                  title={s.active ? 'Deactivate' : 'Activate'}
                >
                  {s.active ? <Icon name="pause" size={13} /> : <Icon name="play" size={13} />}
                </button>
                <button
                  type="button" disabled={busyId === s.id}
                  onClick={() => onDelete(s.id)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BusAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const [manifest, setManifest] = useState(null);

  const { data: schedules = [], isLoading } = useQuery({ queryKey: ['bus-admin-schedules'], queryFn: busAdminSchedules });
  const { data: holidays = [] } = useQuery({ queryKey: ['bus-admin-holidays'], queryFn: busAdminHolidays });
  const { data: today } = useQuery({ queryKey: ['bus-schedule', undefined], queryFn: () => busSchedule() });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bus-admin-schedules'] });
    qc.invalidateQueries({ queryKey: ['bus-admin-holidays'] });
    qc.invalidateQueries({ queryKey: ['bus-schedule', undefined] });
  };
  const fail = (err) => toast.push(apiError(err), 'error', 6000);

  const patch = async (id, p) => {
    setBusyId(id);
    try { await busAdminUpdateSchedule(id, p); refresh(); toast.push('Schedule updated.', 'success'); }
    catch (err) { fail(err); } finally { setBusyId(null); }
  };
  const remove = async (id) => {
    setBusyId(id);
    try { await busAdminDeleteSchedule(id); refresh(); toast.push('Schedule deleted.', 'success'); }
    catch (err) { fail(err); } finally { setBusyId(null); }
  };

  // add-schedule form
  const [form, setForm] = useState({ busNo: 1, origin: 'LNMIIT', destination: 'Raja Park', departureTime: '09:00', pattern: 'weekday', weekdayOnly: '', capacity: 40 });
  const addSchedule = useMutation({
    mutationFn: () => busAdminCreateSchedule({ ...form, weekdayOnly: form.weekdayOnly || undefined }),
    onSuccess: () => { refresh(); toast.push('Timetable row added.', 'success'); },
    onError: fail,
  });

  const [holidayDay, setHolidayDay] = useState('');
  const [holidayLabel, setHolidayLabel] = useState('');
  const addHol = useMutation({
    mutationFn: () => busAdminAddHoliday({ day: holidayDay, label: holidayLabel || undefined }),
    onSuccess: () => { refresh(); toast.push('Holiday added — weekend timetable will apply.', 'success'); setHolidayDay(''); setHolidayLabel(''); },
    onError: fail,
  });

  const regen = useMutation({
    mutationFn: () => busAdminGenerate(),
    onSuccess: (r) => { refresh(); toast.push(`Generated ${r.created} trip(s) for ${r.date}.`, 'success'); },
    onError: fail,
  });

  const openManifest = async (trip) => {
    try { setManifest(await busAdminManifest(trip.id)); } catch (err) { fail(err); }
  };

  const weekdayRows = schedules.filter((s) => s.pattern === 'weekday');
  const weekendRows = schedules.filter((s) => s.pattern === 'weekend_holiday');

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-slate-900 sm:text-3xl">
          Bus <span className="text-gradient">timetable</span>
        </h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => regen.mutate()} disabled={regen.isPending} className="btn-ghost !py-1.5 text-xs">
            {regen.isPending ? 'Generating…' : <><Icon name="refresh" size={14} /> Regenerate today</>}
          </button>
          <Link to="/admin" className="btn-ghost !py-1.5 text-xs">← Admin panel</Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* timetable */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass p-5 lg:col-span-2">
          <h2 className="mb-3 font-display font-bold text-slate-900">Monday – Friday</h2>
          {isLoading ? <div className="skeleton h-40 rounded-xl" /> : (
            <ScheduleTable rows={weekdayRows} onPatch={patch} onDelete={remove} busyId={busyId} />
          )}
          <h2 className="mb-3 mt-7 font-display font-bold text-slate-900">Saturday, Sunday &amp; holidays</h2>
          {!isLoading && <ScheduleTable rows={weekendRows} onPatch={patch} onDelete={remove} busyId={busyId} />}
        </motion.div>

        <div className="space-y-5">
          {/* add row */}
          <motion.form
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
            onSubmit={(e) => { e.preventDefault(); addSchedule.mutate(); }}
            className="glass p-5"
          >
            <h2 className="mb-3 font-display font-bold text-slate-900">Add timetable row</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="text-[11px] text-slate-500">Bus no
                <input type="number" min="1" max="99" value={form.busNo} onChange={(e) => setForm({ ...form, busNo: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-slate-500">Time
                <input type="time" value={form.departureTime} onChange={(e) => setForm({ ...form, departureTime: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-slate-500">From
                <input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-slate-500">To
                <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-slate-500">Pattern
                <select value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} className="input-field mt-1 !py-1.5 text-xs">
                  <option value="weekday">Mon–Fri</option>
                  <option value="weekend_holiday">Sat/Sun/Holiday</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-500">Single weekday
                <select value={form.weekdayOnly} onChange={(e) => setForm({ ...form, weekdayOnly: e.target.value })} disabled={form.pattern !== 'weekday'} className="input-field mt-1 !py-1.5 text-xs">
                  <option value="">All weekdays</option>
                  {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{WD[d]} only</option>)}
                </select>
              </label>
              <label className="col-span-2 text-[11px] text-slate-500">Capacity
                <input type="number" min="1" max="100" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
              </label>
            </div>
            <button type="submit" disabled={addSchedule.isPending} className="btn-primary mt-3 w-full !py-2 text-xs">
              {addSchedule.isPending ? 'Adding…' : '+ Add row'}
            </button>
          </motion.form>

          {/* holidays */}
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="glass p-5">
            <h2 className="mb-3 font-display font-bold text-slate-900">Holidays</h2>
            {holidays.length === 0 && <p className="text-xs text-slate-400">None — weekends already use the holiday timetable.</p>}
            <ul className="space-y-1.5">
              {holidays.map((h) => (
                <li key={h.day} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <span className="font-medium text-slate-700">{new Date(h.day).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}{h.label ? ` — ${h.label}` : ''}</span>
                  <button type="button" onClick={() => busAdminRemoveHoliday(h.day).then(refresh).catch(fail)} className="text-rose-500 hover:text-rose-700">✕</button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => { e.preventDefault(); addHol.mutate(); }}
              className="mt-3 flex gap-2"
            >
              <input type="date" required value={holidayDay} onChange={(e) => setHolidayDay(e.target.value)} className="input-field !py-1.5 text-xs" />
              <input value={holidayLabel} onChange={(e) => setHolidayLabel(e.target.value)} placeholder="Label" className="input-field !py-1.5 text-xs" />
              <button type="submit" disabled={addHol.isPending} className="btn-ghost shrink-0 !px-3 !py-1.5 text-xs">Add</button>
            </form>
          </motion.div>
        </div>
      </div>

      {/* today's manifests */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="glass mt-5 p-5">
        <h2 className="mb-3 font-display font-bold text-slate-900">Today&apos;s trips</h2>
        <div className="flex flex-wrap gap-2">
          {(today?.trips || []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openManifest(t)}
              className={`rounded-xl border px-3 py-2 text-left text-xs transition hover:border-violet-300 ${manifest?.trip?.id === t.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white'}`}
            >
              <div className="font-display font-bold text-slate-900">
                {new Date(t.departureAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Bus {t.busNo}
              </div>
              <div className="text-slate-500">{t.origin} → {t.destination}</div>
              <div className="mt-0.5 font-semibold text-slate-600">{t.booked}/{t.capacity} · {t.status}</div>
            </button>
          ))}
        </div>

        {manifest && (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Manifest — Bus {manifest.trip.bus_no} · {manifest.trip.origin} → {manifest.trip.destination}
              </h3>
              <button type="button" onClick={() => setManifest(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            {manifest.riders.length === 0 ? (
              <p className="text-xs text-slate-400">No bookings.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="py-1 pr-2 font-medium">Rider</th>
                    <th className="py-1 pr-2 font-medium">Roll</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.riders.map((r, i) => (
                    <tr key={i} className="border-t border-slate-200/60">
                      <td className="py-1.5 pr-2 text-slate-800">{r.name}</td>
                      <td className="py-1.5 pr-2 font-mono text-slate-500">{r.roll_number || '—'}</td>
                      <td className="py-1.5 font-semibold text-slate-600">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {manifest.waiting.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                Waiting: {manifest.waiting.map((w) => `${w.name} (${w.roll_number})`).join(', ')}
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* AI ops insights */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <RiderFlagsCard />
        <CapacityAdvisorCard onApply={(id, capacity) => patch(id, { capacity })} busyId={busyId} />
      </div>
    </div>
  );
}
