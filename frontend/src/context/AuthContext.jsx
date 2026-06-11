// Session state for the whole app.
//   status: 'loading' (boot refresh in flight) | 'authed' | 'guest'
// On mount we attempt a silent refresh (httpOnly cookie) so a hard reload
// restores the session without re-login. While authed, the socket is
// identified with the access token so targeted events (waitlist) reach us.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  setAccessToken, getAccessToken, bindSessionHandlers, refreshSession,
  loginRequest, registerRequest, logoutRequest,
} from '../services/api.js';
import { getSocket } from '../services/socket.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  const dropSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('guest');
  }, []);

  useEffect(() => {
    bindSessionHandlers({
      onSession: (u) => { setUser(u); setStatus('authed'); },
      onSessionLost: dropSession,
    });
    refreshSession().catch(() => setStatus('guest'));
  }, [dropSession]);

  // Join the personal socket room (server verifies the JWT).
  useEffect(() => {
    if (status !== 'authed') return undefined;
    const socket = getSocket();
    const identify = () => socket.emit('identify', getAccessToken());
    if (socket.connected) identify();
    socket.on('connect', identify);
    return () => socket.off('connect', identify);
  }, [status, user?.id]);

  const login = useCallback(async (email, password) => {
    const data = await loginRequest(email, password);
    setAccessToken(data.token);
    setUser(data.user);
    setStatus('authed');
    return data.user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const data = await registerRequest(name, email, password);
    setAccessToken(data.token);
    setUser(data.user);
    setStatus('authed');
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await logoutRequest(); } catch { /* cookie may already be gone */ }
    dropSession();
  }, [dropSession]);

  const value = {
    user,
    status,
    isAdmin: user?.role === 'admin',
    login,
    register,
    logout,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
