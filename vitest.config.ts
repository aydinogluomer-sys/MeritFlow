import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Unit tests only; Playwright E2E lives under tests/e2e and runs separately.
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws unless imported by a real server bundler; stub it in unit tests.
      'server-only': fileURLToPath(new URL('./tests/mocks/empty.ts', import.meta.url)),
    },
  },
});
