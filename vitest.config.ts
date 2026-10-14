import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts', 'src/client/**/*.{ts,tsx}'],
      exclude: ['src/client/main.tsx'],
    },
  },
});
