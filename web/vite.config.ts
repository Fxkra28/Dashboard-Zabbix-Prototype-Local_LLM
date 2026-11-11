import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy /bff -> the BFF so the browser never sees Zabbix. /bff/api/hosts  ->
// http://localhost:4000/api/hosts
//
// Both are overridable so the two portal variants can run side by side, e.g.
//   VITE_PORT=5174 BFF_URL=http://localhost:4001 npm run dev
// strictPort: when 5173 is taken Vite would otherwise move to 5174 silently while still proxying to
// :4000, giving a page that looks like one portal and talks to the other's BFF. It stops and says
// the port is in use instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    // Vite 5's default browser floor. Vite 8 raised its own to Chrome 111 and
    // Safari 16.4, which would drop the older wall screens api/ still allows for.
    build: { target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'] },
    server: {
      port: Number(env.VITE_PORT) || 5173,
      strictPort: true,
      proxy: {
        '/bff': {
          target: env.BFF_URL || 'http://localhost:4000',
          // Keep the browser's Host: the BFF refuses a cookie POST whose Origin
          // names another host (auth.ts), and localhost:4000 is not localhost:5173.
          changeOrigin: false,
          rewrite: (p: string) => p.replace(/^\/bff/, ''),
        },
      },
    },
  };
});
