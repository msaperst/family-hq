import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import { addChild, addChore, saveOccurrence } from '../../src/server/chores.js';

describe('API boundary and failure handling', () => {
  it('rejects public IP addresses on household routes but allows health checks', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp({ db });
    try {
      for (const url of ['/api/children', '/api/chores']) {
        const result = await app.inject({ method: 'GET', url, remoteAddress: '8.8.8.8' });
        expect(result.statusCode).toBe(403);
        expect(result.json()).toEqual({ error: 'Household LAN access only' });
      }
      expect((await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8' })).statusCode).toBe(200);
    } finally { await app.close(); db.close(); }
  });
  it('returns a server error for unexpected storage failures', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp({ db });
    try {
      addChild(db, 'porter', 'Porter');
      addChore(db, 'bed', 'Make bed');
      saveOccurrence(db, { id: 'one', key: 'one', choreId: 'bed', startsOn: '2026-10-14', dueOn: '2026-10-14', mode: 'individual', assignees: ['porter'] });
      db.close();
      const result = await app.inject({ method: 'PUT', url: '/api/chores/one/completion', payload: { childId: 'porter', completed: true } });
      expect(result.statusCode).toBe(500);
    } finally { await app.close(); if (db.isOpen) db.close(); }
  });
});
