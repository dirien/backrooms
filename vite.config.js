import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true,
    allowedHosts: true
  },
  build: {
    target: 'esnext'
  }
});
