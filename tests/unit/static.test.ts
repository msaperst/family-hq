import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app';

const originalCwd = process.cwd();
const temporaryDirectories: string[] = [];

function fixture(withAssets: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'family-hq-static-'));
  temporaryDirectories.push(root);
  if (withAssets) {
    mkdirSync(join(root, 'dist/client'), { recursive: true });
    writeFileSync(join(root, 'dist/client/index.html'), '<!doctype html><title>Family HQ fixture</title>');
    writeFileSync(join(root, 'dist/client/example.css'), 'body { margin: 0 }');
  }
  process.chdir(root);
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of temporaryDirectories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('production static hosting', () => {
  it('rejects missing build assets', () => {
    fixture(false);
    expect(() => buildApp({ serveClient: true })).toThrow('Built client assets missing');
  });

  it('serves the app and SPA routes while keeping unknown APIs at 404', async () => {
    fixture(true);
    const app = buildApp({ serveClient: true });
    try {
      const index = await app.inject({ method: 'GET', url: '/' });
      expect(index.statusCode).toBe(200);
      expect(index.body).toContain('Family HQ fixture');

      const route = await app.inject({ method: 'GET', url: '/chores/today' });
      expect(route.statusCode).toBe(200);
      expect(route.body).toContain('Family HQ fixture');

      const asset = await app.inject({ method: 'GET', url: '/example.css' });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toContain('margin: 0');

      const api = await app.inject({ method: 'GET', url: '/api/missing' });
      expect(api.statusCode).toBe(404);

      const missingAsset = await app.inject({ method: 'GET', url: '/missing.css' });
      expect(missingAsset.statusCode).toBe(404);

      const post = await app.inject({ method: 'POST', url: '/chores/today' });
      expect(post.statusCode).toBe(404);

      const health = await app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
