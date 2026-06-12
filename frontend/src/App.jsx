import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from './hooks/useAuth.js';
import { ToastProvider } from './components/ui/Toast.jsx';
import EventsListPage from './pages/EventsListPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import Icon from './components/ui/Icon.jsx';

// Route-level code-splitting: heavy pages (recharts dashboards, admin tooling,
// the booking flows) load on demand so the landing chunk stays small.
const EventPage = lazy(() => import('./pages/EventPage.jsx'));
const ConfirmationPage = lazy(() => import('./pages/ConfirmationPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const MyBookingsPage = lazy(() => import('./pages/MyBookingsPage.jsx'));
const BusSchedulePage = lazy(() => import('./pages/BusSchedulePage.jsx'));
const BusTripPage = lazy(() => import('./pages/BusTripPage.jsx'));
const BusAdminPage = lazy(() => import('./pages/BusAdminPage.jsx'));

function PageSpinner() {
  return (
    <div className="flex justify-center py-24">
      <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-violet-200 border-t-violet-600" />
    </div>
  );
}

function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status !== 'authed') return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { status, isAdmin } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageSpinner />;
  if (status !== 'authed') return <Navigate to="/login" state={{ from: location }} replace />;
  if (!isAdmin) {
    return (
      <div className="glass mx-auto mt-16 max-w-md p-10 text-center">
        <Icon name="ban" size={40} className="mx-auto text-rose-400" />
        <h1 className="mt-3 font-display text-xl font-bold text-slate-900">Admins only</h1>
        <p className="mt-1 text-sm text-slate-500">Your account doesn&apos;t have access to this page.</p>
        <Link to="/" className="btn-ghost mt-5">Back to events</Link>
      </div>
    );
  }
  return children;
}

function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/**
 * Submerged navbar: fixed, fully transparent while sitting on the home hero
 * photo, then frosted white with a hairline once you scroll (and on every
 * other page). No pill, no box — it belongs to the page behind it.
 */
function Header() {
  const { user, status, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const scrolled = useScrolled();
  const onMedia = pathname === '/' && !scrolled; // transparent over the hero

  const links = [
    { to: '/', label: 'Events', show: true, end: true },
    { to: '/bus', label: 'Bus', show: true },
    { to: '/my-bookings', label: 'My bookings', show: status === 'authed' },
    { to: '/admin', label: 'Admin', show: isAdmin },
  ].filter((l) => l.show);

  const linkClass = ({ isActive }) =>
    `border-b-2 pb-0.5 text-[12px] font-semibold uppercase tracking-[0.16em] transition-colors ${
      isActive
        ? 'border-slate-950 text-slate-950 font-bold'
        : 'border-transparent text-slate-500 hover:text-slate-950'
    }`;

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
        onMedia
          ? 'bg-white/40 border-b border-white/40 backdrop-blur-sm shadow-[0_1px_3px_rgba(15,23,42,0.02)]'
          : 'bg-white/80 border-b border-slate-200/50 backdrop-blur-md shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link to="/" className="group flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-sm shadow-sm transition-transform group-hover:rotate-6">
            <Icon name="ticket" size={16} className="text-white" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">
            Seat<span className="text-gradient">Live</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-7 sm:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 text-sm">
          {status === 'authed' ? (
            <>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 font-display text-xs font-bold uppercase text-white shadow-sm">
                {user.name?.[0] || '?'}
              </span>
              <span className="hidden md:inline text-slate-700 font-medium">{user.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  isAdmin
                    ? 'bg-slate-950 text-white'
                    : 'border border-slate-200/60 bg-white/70 text-slate-600 backdrop-blur-sm'
                }`}
              >
                {user.role}
              </span>
              <button
                type="button"
                onClick={doLogout}
                className="rounded-xl border border-slate-200/70 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white/95 hover:border-slate-300 transition"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-xl border border-slate-200/70 bg-white/60 px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white/95 hover:border-slate-300 transition"
              >
                Sign in
              </Link>
              <Link to="/register" className="btn-primary !px-4 !py-1.5">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-slate-200 py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-slate-500">
        <span className="font-display font-semibold text-slate-600">
          <Icon name="ticket" size={14} className="-mt-0.5 mr-1.5 text-slate-400" />SeatLive — real-time seat booking
        </span>
        <span>
          React · Socket.io · Redis Lua holds · Postgres replication · BullMQ · nginx ×2 nodes
        </span>
      </div>
    </footer>
  );
}

export default function App() {
  const location = useLocation();
  const isHome = location.pathname === '/';
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <Header />
        {/* Home starts at the very top so the hero photo runs underneath the
            transparent navbar; every other page clears the fixed header. */}
        <main className={`mx-auto w-full max-w-6xl flex-1 px-4 pb-8 ${isHome ? 'pt-0' : 'pt-24'}`}>
          {/* Enter-only page transition. Deliberately NOT AnimatePresence
              mode="wait": exit phases freeze the outgoing tree, and a frozen
              guard rendering <Navigate> re-fires into the router forever. */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <Suspense fallback={<PageSpinner />}>
            <Routes>
              <Route path="/" element={<EventsListPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/events/:id" element={<EventPage />} />
              <Route path="/bus" element={<BusSchedulePage />} />
              <Route path="/bus/trips/:id" element={<BusTripPage />} />
              <Route path="/my-bookings" element={<RequireAuth><MyBookingsPage /></RequireAuth>} />
              <Route path="/confirmation" element={<RequireAuth><ConfirmationPage /></RequireAuth>} />
              <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
              <Route path="/admin/bus" element={<RequireAdmin><BusAdminPage /></RequireAdmin>} />
              <Route path="/events/:id/dashboard" element={<RequireAdmin><DashboardPage /></RequireAdmin>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </motion.div>
        </main>
        <Footer />
      </div>
    </ToastProvider>
  );
}
