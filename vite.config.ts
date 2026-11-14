import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client lives in client/, builds to client/dist. Dev: 5173, /api proxied to Express on 3001.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3001' },
    fs: { allow: ['..'] }, // client imports ../shared
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
