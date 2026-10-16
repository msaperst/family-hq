import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';

describe('household API security boundary', () => {
  it('applies the LAN restriction to parent routes registered before dashboard routes', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp({ db });
    try {
      const response = await app.inject({
        method: 'GET', url: '/api/parent/schedules', remoteAddress: '8.8.8.8',
      });
      expect(response.statusCode).toBe(403);
    } finally { await app.close(); db.close(); }
  });

  it('rejects cross-site mutations while allowing same-host writes to reach route validation', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp({ db });
    try {
      for (const origin of ['https://attacker.example', 'null', 'https://localhost.evil.example']) {
        const response = await app.inject({
          method: 'POST', url: '/api/parent/schedules',
          headers: { host: 'localhost:3080', origin, 'content-type': 'application/json' },
          payload: {},
        });
        expect(response.statusCode).toBe(403);
      }
      const accepted = await app.inject({
        method: 'POST', url: '/api/parent/schedules',
        headers: { host: 'localhost:3080', origin: 'http://localhost:5173', 'content-type': 'application/json' },
        payload: {},
      });
      expect(accepted.statusCode).toBe(400);
    } finally { await app.close(); db.close(); }
  });
});
