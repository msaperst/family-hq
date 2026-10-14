import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts', 'src/client/**/*.{ts,tsx}'],
      // Entrypoints are exercised by the Docker smoke test; type-only declarations
      // have no runtime behavior. Keep them in Sonar static analysis.
      exclude: ['src/client/main.tsx', 'src/server/index.ts', 'src/shared/health.ts'],
    },
  },
});
