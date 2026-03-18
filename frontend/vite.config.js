import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // En desarrollo, proxea las llamadas a /api al backend local
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/webhook': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
