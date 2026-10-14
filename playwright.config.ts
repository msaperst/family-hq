import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dbPath = join(tmpdir(), 'family-hq-playwright-' + randomUUID() + '.sqlite');
const baseURL = 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './tests/e2e/browser',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  workers: 1,
  globalSetup: './tests/e2e/browser/setup.ts',
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { FAMILY_HQ_DB_PATH: dbPath, FAMILY_HQ_PORT: '3080', HOST: '127.0.0.1' },
  },
  metadata: { dbPath },
});
