import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts';
import { getEventStats } from '../services/api.js';
import { useCountUp } from '../hooks/useCountUp.js';

const STATUS_COLORS = { available: '#34d399', held: '#fbbf24', booked: '#fb7185' };
const PIE_COLORS = ['#8b5cf6', '#d946ef', '#22d3ee', '#34d399', '#fbbf24'];

const tooltipStyle = {
  background: 'rgba(16,16,26,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  color: '#e4e4ef',
  fontSize: 12,
};

function Stat({ label, value, prefix = '', suffix = '', delay = 0 }) {
  const n = useCountUp(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="glass p-5"
    >
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 font-display text-3xl font-extrabold">
        {prefix}{n.toLocaleString()}{suffix}
      </div>
    </motion.div>
  );
}

function Card({ title, children, wide, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      transition={{ delay }} className={`glass p-5 ${wide ? 'lg:col-span-2' : ''}`}
    >
      <h2 className="mb-4 font-display font-bold">{title}</h2>
      {children}
    </motion.div>
  );
}

export default function DashboardPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats', id],
    queryFn: () => getEventStats(id),
    enabled: Boolean(id),
    refetchInterval: 5000, // dashboards stay live
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
      </div>
    );
  }
  if (error) return <p className="text-rose-400">Failed to load analytics (admin only).</p>;

  const statusData = data.seatsByStatus.map((s) => ({ name: s.status, value: s.count }));
  const revData = data.revenueByCategory.map((c) => ({ name: c.category, revenue: c.revenue, booked: c.booked }));
  const timeline = data.bookingsTimeline.map((t) => ({
    time: new Date(t.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    count: t.count,
  }));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
          {data.event.name} — <span className="text-gradient">analytics</span>
        </h1>
        <div className="flex items-center gap-2">
          <span className="chip text-cyan-300">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-cyan-400" />
            auto-refresh 5s
          </span>
          <Link to={`/events/${id}`} className="btn-ghost !py-1.5 text-xs">Seat map →</Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total seats" value={data.event.total_seats} />
        <Stat label="Available" value={data.event.available_seats} delay={0.06} />
        <Stat label="Occupancy" value={data.occupancy} suffix="%" delay={0.12} />
        <Stat label="Revenue" value={data.totalRevenue} prefix="$" delay={0.18} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Seats by status">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={statusData} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} stroke="#64748b" tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {statusData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] || '#64748b'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Revenue by category" delay={0.08}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={revData} dataKey="revenue" nameKey="name"
                innerRadius={55} outerRadius={88} paddingAngle={4} cornerRadius={6}
                label={(e) => `${e.name} $${e.revenue}`}
              >
                {revData.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="transparent" />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Confirmed bookings over time" wide delay={0.12}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={timeline}>
              <defs>
                <linearGradient id="grad-bookings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} stroke="#64748b" tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="count" name="bookings" stroke="#a78bfa" strokeWidth={2.5} fill="url(#grad-bookings)" />
            </AreaChart>
          </ResponsiveContainer>
          {timeline.length === 0 && (
            <p className="mt-2 text-center text-sm text-slate-500">No confirmed bookings yet — they&apos;ll stream in here.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
