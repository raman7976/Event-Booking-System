// Singleton Socket.io client, path /ws. Same-origin in local dev (Vite proxies
// /ws to nginx). For a split deploy, VITE_API_URL points it at the backend origin;
// withCredentials carries cookies on the WS handshake (cross-site).
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || undefined; // undefined = page origin

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      path: '/ws',
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
  }
  return socket;
}
