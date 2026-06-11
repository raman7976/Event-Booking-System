import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.js';
import EventsListPage from './pages/EventsListPage.jsx';
import EventPage from './pages/EventPage.jsx';
import ConfirmationPage from './pages/ConfirmationPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import MyBookingsPage from './pages/MyBookingsPage.jsx';

function PageSpinner() {
  return <div className="py-20 text-center text-slate-400">Loading…</div>;
}

// Route guards. While the silent-refresh bootstrap is in flight we show a
// spinner instead of bouncing the user to /login on every hard reload.
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
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-red-900/50 bg-red-950/30 p-8 text-center">
        <div className="text-3xl">🚫</div>
        <h1 className="mt-2 text-xl font-bold">Admins only</h1>
        <p className="mt-1 text-sm text-slate-400">Your account doesn&apos;t have access to this page.</p>
        <Link to="/" className="mt-4 inline-block rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600">Back to events</Link>
      </div>
    );
  }
  return children;
}

function Header() {
  const { user, status, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const navClass = ({ isActive }) =>
    `rounded px-2.5 py-1.5 text-sm transition ${isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`;

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold tracking-tight">🎟️ SeatLive</Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>Events</NavLink>
            {status === 'authed' && <NavLink to="/my-bookings" className={navClass}>My bookings</NavLink>}
            {isAdmin && <NavLink to="/admin" className={navClass}>Admin</NavLink>}
          </nav>
        </div>

        <div className="flex items-center gap-2.5 text-sm">
          {status === 'authed' ? (
            <>
              <span className="hidden text-slate-300 sm:inline">{user.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  isAdmin ? 'bg-purple-700/70 text-purple-100' : 'bg-slate-700 text-slate-300'
                }`}
              >
                {user.role}
              </span>
              <button type="button" onClick={doLogout} className="rounded bg-slate-800 px-3 py-1.5 hover:bg-slate-700">
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="rounded bg-slate-800 px-3 py-1.5 hover:bg-slate-700">Sign in</Link>
              <Link to="/register" className="rounded bg-blue-600 px-3 py-1.5 font-semibold hover:bg-blue-500">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-6">
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
      </main>
    </div>
  );
}
