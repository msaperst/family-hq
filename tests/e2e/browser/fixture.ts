import { test as base } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('No port')); return; }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}
async function ready(url: string, exited: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exited()) throw new Error('Development server exited before startup');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Development server did not become ready: ' + url);
}

export const test = base.extend({
  baseURL: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'family-hq-playwright-'));
    const dbPath = join(dir, 'test.sqlite');
    const apiPort = await freePort();
    const vitePort = await freePort();
    const env = { ...process.env, FAMILY_HQ_DB_PATH: dbPath, FAMILY_HQ_PORT: String(apiPort), VITE_PORT: String(vitePort), HOST: '127.0.0.1' };
    const init = "import {openDatabase} from './src/server/db.ts'; const db=openDatabase(process.env.FAMILY_HQ_DB_PATH); db.close();";
    let server: ReturnType<typeof spawn> | undefined;
    let vite: ReturnType<typeof spawn> | undefined;
    let serverOutput = '';
    try {
      execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', init], { env });
      execFileSync(process.execPath, ['tests/e2e/seed.mjs'], { env });
      server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout?.on('data', (chunk: Buffer) => { serverOutput += chunk.toString(); });
      server.stderr?.on('data', (chunk: Buffer) => { serverOutput += chunk.toString(); });
      vite = spawn('npm', ['run', 'dev:client'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      vite.stdout?.on('data', (chunk: Buffer) => { serverOutput += chunk.toString(); });
      vite.stderr?.on('data', (chunk: Buffer) => { serverOutput += chunk.toString(); });
      try {
        await ready('http://127.0.0.1:' + vitePort + '/', () => server!.exitCode !== null || vite.exitCode !== null);
        await ready('http://127.0.0.1:' + vitePort + '/api/health', () => server!.exitCode !== null);
      } catch (error) {
        throw new Error(`${String(error)}\nServer output:\n${serverOutput.slice(-6000)}`);
      }
      await use('http://127.0.0.1:' + vitePort);
    } finally {
      if (vite?.pid) {
        try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already exited */ }
      }
      if (server?.pid) {
        try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already exited */ }
      }
      for (const suffix of ['', '-wal', '-shm']) {
        const file = dbPath + suffix;
        if (existsSync(file)) rmSync(file);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
});
