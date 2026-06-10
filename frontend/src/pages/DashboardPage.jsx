import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { getEventStats } from '../services/api.js';

const STATUS_COLORS = { available: '#22c55e', held: '#eab308', booked: '#ef4444' };
const PIE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#a855f7', '#06b6d4', '#ef4444'];

export default function DashboardPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats', id],
    queryFn: () => getEventStats(id),
    enabled: Boolean(id),
    refetchInterval: 5000, // keep the dashboard live
  });

  if (isLoading) return <p className="text-slate-400">Loading analytics…</p>;
  if (error) return <p className="text-red-400">Failed to load analytics.</p>;

  const statusData = data.seatsByStatus.map((s) => ({ name: s.status, value: s.count }));
  const revData = data.revenueByCategory.map((c) => ({ name: c.category, revenue: c.revenue, booked: c.booked }));
  const timeline = data.bookingsTimeline.map((t) => ({
    time: new Date(t.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    count: t.count,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{data.event.name} — analytics</h1>
        <Link to={`/events/${id}`} className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">Seat map</Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total seats" value={data.event.total_seats} />
        <Stat label="Available" value={data.event.available_seats} />
        <Stat label="Occupancy" value={`${data.occupancy}%`} />
        <Stat label="Revenue" value={`$${data.totalRevenue}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Seats by status">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={statusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis allowDecimals={false} stroke="#94a3b8" />
              <Tooltip contentStyle={{ background: '#1e293b', border: 'none' }} />
              <Bar dataKey="value">
                {statusData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] || '#64748b'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Revenue by category">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={revData} dataKey="revenue" nameKey="name" outerRadius={90} label={(e) => `${e.name}: $${e.revenue}`}>
                {revData.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#1e293b', border: 'none' }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Confirmed bookings over time" wide>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" />
              <YAxis allowDecimals={false} stroke="#94a3b8" />
              <Tooltip contentStyle={{ background: '#1e293b', border: 'none' }} />
              <Legend />
              <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} name="bookings" />
            </LineChart>
          </ResponsiveContainer>
          {timeline.length === 0 && <p className="mt-2 text-center text-sm text-slate-500">No confirmed bookings yet.</p>}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
function Card({ title, children, wide }) {
  return (
    <div className={`rounded-xl bg-slate-800 p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </div>
  );
}
