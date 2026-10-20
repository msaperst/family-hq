import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { allowedApiHosts, trustedApiPeer } from '../../src/server/api.js';
import { openDatabase } from '../../src/server/db.js';

describe('household API security boundary', () => {
  it('rejects DNS-rebinding Host authorities when the allowlist is enabled', async () => {
    const original = process.env.FAMILY_HQ_ALLOWED_HOSTS;
    process.env.FAMILY_HQ_ALLOWED_HOSTS = 'family.example.test,localhost:3080';
    const db = openDatabase(':memory:');
    const app = buildApp({ db });
    try {
      for (const host of ['attacker.example.test', 'family.example.test.evil.test', 'localhost:9999']) {
        const response = await app.inject({ method: 'GET', url: '/api/children',
          headers: { host }, remoteAddress: '127.0.0.1' });
        expect(response.statusCode).toBe(403);
      }
      const accepted = await app.inject({ method: 'GET', url: '/api/children',
        headers: { host: 'FAMILY.EXAMPLE.TEST' } });
      expect(accepted.statusCode).toBe(200);
      const changed = await app.inject({ method: 'POST', url: '/api/parent/children',
        headers: { host: 'attacker.example.test', 'content-type': 'application/json' },
        payload: { name: 'Unexpected' } });
      expect(changed.statusCode).toBe(403);
    } finally {
      await app.close();
      db.close();
      if (original === undefined) delete process.env.FAMILY_HQ_ALLOWED_HOSTS;
      else process.env.FAMILY_HQ_ALLOWED_HOSTS = original;
    }
  });

  it('fails closed for malformed Host allowlist entries', () => {
    for (const invalid of ['', 'host/', 'host:abc', 'host,,other', 'evil.test/path', 'evil..test']) {
      expect(() => allowedApiHosts(invalid)).toThrow();
    }
    expect(allowedApiHosts('localhost:3080')('localhost:3080')).toBe(true);
    expect(allowedApiHosts('localhost:3080')('localhost')).toBe(false);
  });

  it('blocks cross-site browser reads and writes without trusting forwarded IPs', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp({ db });
    try {
      for (const [method, url] of [
        ['GET', '/api/children'], ['GET', '/api/parent/schedules'],
        ['POST', '/api/parent/children'],
      ]) {
        const response = await app.inject({
          method: method as 'GET' | 'POST', url, remoteAddress: '127.0.0.1',
          headers: { host: 'localhost:3080', 'sec-fetch-site': 'cross-site',
            'x-forwarded-for': '192.168.1.5' },
          ...(method === 'POST' ? { payload: { name: 'Test' } } : {}),
        });
        expect(response.statusCode).toBe(403);
      }
      const sameOrigin = await app.inject({
        method: 'GET', url: '/api/children',
        headers: { 'sec-fetch-site': 'same-origin' },
      });
      expect(sameOrigin.statusCode).toBe(200);
      const nonBrowser = await app.inject({ method: 'GET', url: '/api/children' });
      expect(nonBrowser.statusCode).toBe(200);
    } finally { await app.close(); db.close(); }
  });

  it('restricts explicit peer CIDRs and supports IPv4-mapped Docker peers', () => {
    const allowed = trustedApiPeer('127.0.0.1/32,172.18.0.0/16,192.168.1.0/24');
    expect(allowed('127.0.0.1')).toBe(true);
    expect(allowed('172.18.0.12')).toBe(true);
    expect(allowed('::ffff:192.168.1.45')).toBe(true);
    expect(allowed('192.168.0.45')).toBe(false);
    expect(allowed('8.8.8.8')).toBe(false);
    for (const invalid of ['', '10.0.0.0/33', '192.168.1.1', 'not-an-ip/12']) {
      expect(() => trustedApiPeer(invalid)).toThrow();
    }
  });

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
