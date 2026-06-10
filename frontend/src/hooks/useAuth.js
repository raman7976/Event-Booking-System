import { useCallback, useEffect, useState } from 'react';
import { ensureGuest, getUser, newGuest as apiNewGuest } from '../services/api.js';

// Ensures a (guest) identity exists so seats can be held/booked.
export function useAuth() {
  const [user, setUser] = useState(getUser());

  useEffect(() => {
    let mounted = true;
    if (!user) {
      ensureGuest()
        .then((u) => mounted && setUser(u))
        .catch(() => {});
    }
    return () => { mounted = false; };
  }, [user]);

  const switchGuest = useCallback(async () => {
    const u = await apiNewGuest();
    setUser(u);
    return u;
  }, []);

  return { user, switchGuest };
}
