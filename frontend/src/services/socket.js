// Singleton Socket.io client. Connects to the page origin with path /ws; in dev
// Vite proxies /ws to nginx (ip_hash) which pins the socket to one Node instance.
import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io({
      path: '/ws',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
  }
  return socket;
}
