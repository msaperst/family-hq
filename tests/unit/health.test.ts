import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';

describe('health endpoint', () => {
  it('returns the expected health response', async () => {
    const app = buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', service: 'family-hq' });
    } finally {
      await app.close();
    }
  });
});
