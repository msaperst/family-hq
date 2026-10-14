import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';

export default function setup(config: FullConfig): () => void {
  const dbPath = config.metadata.dbPath as string;
  if (!dbPath.includes('family-hq-playwright-')) throw new Error('Unsafe test database path');
  // Server migrations must exist before the seed runs. Start a short-lived server
  // that initializes the disposable database and exits after the health check.
  const init = `import {openDatabase} from './src/server/db.ts'; const db=openDatabase(process.env.FAMILY_HQ_DB_PATH); db.close();`;
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', init], {
    env: { ...process.env, FAMILY_HQ_DB_PATH: dbPath },
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['tests/e2e/seed.mjs'], {
    env: { ...process.env, FAMILY_HQ_DB_PATH: dbPath },
    stdio: 'inherit',
  });
  return () => {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = dbPath + suffix;
      if (existsSync(file)) rmSync(file);
    }
  };
}
