import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the browser talks to Vite (5173); Vite proxies /api and /ws to nginx
// (localhost:80), which load-balances across the two Node instances. This keeps
// everything same-origin (no CORS) and routes WebSockets through nginx.
const NGINX = process.env.NGINX_URL || 'http://localhost:80';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: NGINX, changeOrigin: true },
      '/ws': { target: NGINX, changeOrigin: true, ws: true },
    },
  },
});
