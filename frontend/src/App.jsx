import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from './hooks/useAuth.js';
import { ToastProvider } from './components/ui/Toast.jsx';
import EventsListPage from './pages/EventsListPage.jsx';
import EventPage from './pages/EventPage.jsx';
import ConfirmationPage from './pages/ConfirmationPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import MyBookingsPage from './pages/MyBookingsPage.jsx';

function PageSpinner() {
  return (
    <div className="flex justify-center py-24">
      <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-violet-500/25 border-t-violet-400" />
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
        <div className="text-4xl">🚫</div>
        <h1 className="mt-3 font-display text-xl font-bold">Admins only</h1>
        <p className="mt-1 text-sm text-slate-400">Your account doesn&apos;t have access to this page.</p>
        <Link to="/" className="btn-ghost mt-5">Back to events</Link>
      </div>
    );
  }
  return children;
}

function Header() {
  const { user, status, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const links = [
    { to: '/', label: 'Events', show: true, end: true },
    { to: '/my-bookings', label: 'My bookings', show: status === 'authed' },
    { to: '/admin', label: 'Admin', show: isAdmin },
  ].filter((l) => l.show);

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 px-3 pt-3">
      <div className="glass mx-auto flex max-w-6xl items-center justify-between gap-3 !rounded-2xl px-4 py-2.5">
        <div className="flex items-center gap-5">
          <Link to="/" className="group flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-sm shadow-glow-sm transition-transform group-hover:rotate-6">
              🎟️
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              Seat<span className="text-gradient">Live</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className="relative rounded-lg px-3 py-1.5 text-sm font-medium">
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-lg bg-white/10 ring-1 ring-white/15"
                        transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                      />
                    )}
                    <span className={`relative ${isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                      {l.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2.5 text-sm">
          {status === 'authed' ? (
            <>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/60 to-fuchsia-600/60 font-display text-xs font-bold uppercase">
                {user.name?.[0] || '?'}
              </span>
              <span className="hidden text-slate-300 md:inline">{user.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  isAdmin
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-glow-sm'
                    : 'border border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                {user.role}
              </span>
              <button type="button" onClick={doLogout} className="btn-ghost !px-3 !py-1.5">
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost !px-3.5 !py-1.5">Sign in</Link>
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
    <footer className="mt-20 border-t border-white/5 py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-slate-500">
        <span className="font-display font-semibold text-slate-400">
          🎟️ SeatLive — real-time seat booking
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
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {/* Enter-only page transition. Deliberately NOT AnimatePresence
              mode="wait": exit phases freeze the outgoing tree, and a frozen
              guard rendering <Navigate> re-fires into the router forever. */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <Routes>
              <Route path="/" element={<EventsListPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/events/:id" element={<EventPage />} />
              <Route path="/my-bookings" element={<RequireAuth><MyBookingsPage /></RequireAuth>} />
              <Route path="/confirmation" element={<RequireAuth><ConfirmationPage /></RequireAuth>} />
              <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
              <Route path="/events/:id/dashboard" element={<RequireAdmin><DashboardPage /></RequireAdmin>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </main>
        <Footer />
      </div>
    </ToastProvider>
  );
}
