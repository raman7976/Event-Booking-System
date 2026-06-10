import { Routes, Route, Link, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.js';
import EventsListPage from './pages/EventsListPage.jsx';
import EventPage from './pages/EventPage.jsx';
import ConfirmationPage from './pages/ConfirmationPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

export default function App() {
  const { user, switchGuest } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold">🎟️ SeatLive</Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-400">{user ? `Signed in as ${user.name}` : 'Connecting…'}</span>
            <button type="button" onClick={switchGuest} className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700">
              New guest
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<EventsListPage />} />
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/events/:id/dashboard" element={<DashboardPage />} />
          <Route path="/confirmation" element={<ConfirmationPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
