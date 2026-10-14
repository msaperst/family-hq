import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.FAMILY_HQ_PORT || 3080);
  const vitePort = Number(env.VITE_PORT || 5173);
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: vitePort,
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    build: { outDir: 'dist/client', emptyOutDir: true },
    test: {
      coverage: {
        include: ['src/**/*.{ts,tsx,js,jsx}'],
        exclude: ['src/**/*.d.ts'],
      },
    },
  };
});
