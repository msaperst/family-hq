import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';

describe('API integration', () => {
  it('returns the health contract and rejects unknown API routes', async () => {
    const app = buildApp();
    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok', service: 'family-hq' });
      const unknown = await app.inject({ method: 'GET', url: '/api/chores' });
      expect(unknown.statusCode).toBe(404);
      const post = await app.inject({ method: 'POST', url: '/api/chores', payload: { completed: true } });
      expect(post.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
