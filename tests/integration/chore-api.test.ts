import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import { addChild, addChore, saveOccurrence } from '../../src/server/chores.js';
import type { DashboardResponse } from '../../src/shared/dashboard.js';

describe('chore API', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    db = openDatabase(':memory:');
    app = buildApp({ db });
    addChild(db, 'porter', 'Porter');
    addChild(db, 'miller', 'Miller');
    addChore(db, 'bed', 'Make bed');
  });
  afterEach(async () => { await app.close(); db.close(); });
  function occurrence(id: string, mode: 'individual' | 'either' | 'each', assignees: string[], startsOn = '2026-10-14', dueOn = startsOn) {
    saveOccurrence(db, { id, key: id, choreId: 'bed', startsOn, dueOn, mode, assignees });
  }
  async function get(date = '2026-10-14') {
    const response = await app.inject({ method: 'GET', url: '/api/chores?date=' + date });
    expect(response.statusCode).toBe(200);
    return response.json() as DashboardResponse;
  }
  it('returns no empty columns, including shared', async () => {
    expect((await get()).columns).toEqual([]);
    occurrence('a', 'individual', ['porter']);
    const result = await get();
    expect(result.columns.map(x => x.name)).toEqual(['Porter']);
    expect(result.columns[0].chores[0].name).toBe('Make bed');
  });
  it('separates each-child obligations and deduplicates either-child obligations', async () => {
    occurrence('each', 'each', ['porter', 'miller']);
    occurrence('shared', 'either', ['porter', 'miller']);
    const result = await get();
    expect(result.columns.map(x => x.id)).toEqual(['miller', 'porter', 'either']);
    expect(result.columns.map(x => x.chores.length)).toEqual([1, 1, 1]);
    expect(result.columns[2].chores[0].childId).toBeNull();
  });
  it('keeps incomplete overdue chores, but not completed past chores', async () => {
    occurrence('old', 'individual', ['porter'], '2026-10-12');
    expect((await get()).columns[0].chores[0].dueOn).toBe('2026-10-12');
    await app.inject({ method: 'PUT', url: '/api/chores/old/completion', payload: { childId: 'porter', completed: true } });
    expect((await get()).columns).toEqual([]);
  });
  it('persists idempotent completion and supports unchecking', async () => {
    occurrence('a', 'individual', ['porter']);
    const url = '/api/chores/a/completion';
    const first = await app.inject({ method: 'PUT', url, payload: { childId: 'porter', completed: true } });
    expect(first.json()).toEqual({ changed: true, completed: true });
    const again = await app.inject({ method: 'PUT', url, payload: { childId: 'porter', completed: true } });
    expect(again.json()).toEqual({ changed: false, completed: true });
    expect((await get()).columns[0].chores[0].completed).toBe(true);
    const undo = await app.inject({ method: 'PUT', url, payload: { childId: 'porter', completed: false } });
    expect(undo.json().changed).toBe(true);
    expect((await get()).columns[0].chores[0].completed).toBe(false);
    const events = db.prepare('SELECT id FROM completion_events').all();
    expect(events).toHaveLength(2);
  });
  it('validates query and completion payloads', async () => {
    for (const url of ['/api/chores?date=2026-02-30', '/api/chores?more=yes']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    }
    occurrence('a', 'individual', ['porter']);
    for (const payload of [{ completed: 'true' }, { completed: true, childId: 7 }, { completed: true, childId: 'other' }]) {
      const result = await app.inject({ method: 'PUT', url: '/api/chores/a/completion', payload });
      expect([400, 404]).toContain(result.statusCode);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/chores/missing/completion', payload: { completed: true } })).statusCode).toBe(404);
  });
  it('excludes deactivated children and lists only active children', async () => {
    occurrence('a', 'individual', ['porter']);
    db.prepare('UPDATE children SET active = 0 WHERE id = ?').run('porter');
    expect((await get()).columns).toEqual([]);
    const response = await app.inject({ method: 'GET', url: '/api/children' });
    expect(response.json().children).toEqual([{ id: 'miller', name: 'Miller' }]);
  });
  it('rejects malformed completion bodies and missing targets', async () => {
    occurrence('a', 'individual', ['porter']);
    const url = '/api/chores/a/completion';
    for (const payload of [
      {}, { completed: null }, { completed: 'yes' },
      { completed: true, childId: [] }, { completed: true, performedBy: 3 },
      { completed: true, performedBy: 'miller' },
    ]) {
      const result = await app.inject({ method: 'PUT', url, payload });
      expect([400, 404]).toContain(result.statusCode);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/chores/missing/completion', payload: { completed: true } })).statusCode).toBe(404);
    expect((await get()).columns[0].chores[0].completed).toBe(false);
  });
  it('validates dates and expanded horizon', async () => {
    for (const date of ['bad', '2026-02-30', '2026-13-01', '2026-10-14T00:00:00Z']) {
      expect((await app.inject({ method: 'GET', url: '/api/chores?date=' + encodeURIComponent(date) })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/chores?more=1' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/chores?more=false' })).statusCode).toBe(200);
    const extended = await app.inject({ method: 'GET', url: '/api/chores?date=2026-10-14&more=true' });
    expect(extended.statusCode).toBe(200);
    expect((extended.json() as DashboardResponse).through).toBe('2026-11-10');
  });
  it('generates scheduled chores when requested', async () => {
    db.prepare(`INSERT INTO chore_schedules (id, chore_id, mode, frequency, anchor_date)
      VALUES ('schedule', 'bed', 'individual', 'daily', '2026-10-14')`).run();
    db.prepare('INSERT INTO schedule_assignees (schedule_id, child_id) VALUES (?, ?)').run('schedule', 'porter');
    const result = await get();
    expect(result.columns[0].chores).toHaveLength(7);
    expect(result.columns[0].chores[0].dueOn).toBe('2026-10-14');
    const again = await get();
    expect(again.columns[0].chores).toHaveLength(7);
  });
});
