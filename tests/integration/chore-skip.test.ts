import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db';
import { buildApp } from '../../src/server/app';
import { addChild, addChore, saveOccurrence } from '../../src/server/chores';

describe('skipping chores', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    db = openDatabase(':memory:');
    app = buildApp({ db });
    addChild(db, 'a', 'Alex');
    addChild(db, 'b', 'Blair');
    addChore(db, 'task', 'Make bed');
  });
  afterEach(async () => { await app.close(); db.close(); });
  function occurrence(id: string, mode: 'individual' | 'each', dueOn: string) {
    saveOccurrence(db, { id, key: id, choreId: 'task', mode, startsOn: dueOn, dueOn, assignees: mode === 'each' ? ['a','b'] : ['a'] });
  }
  async function request(id: string, childId: string, skipped: boolean) {
    return app.inject({ method: 'PUT', url: '/api/chores/' + id + '/skip', payload: { childId, skipped } });
  }
  async function columns() {
    const response = await app.inject({ method: 'GET', url: '/api/chores?date=2026-10-25' });
    expect(response.statusCode).toBe(200);
    return response.json().columns as { id: string; chores: { skipped: boolean; completed: boolean }[] }[];
  }
  it('treats skip and undo as idempotent transitions', async () => {
    occurrence('repeat', 'individual', '2026-10-25');
    expect((await request('repeat', 'a', false)).json()).toMatchObject({ changed: false });
    expect((await request('repeat', 'a', true)).json()).toMatchObject({ changed: true });
    expect((await request('repeat', 'a', true)).json()).toMatchObject({ changed: false });
    expect((await request('repeat', 'a', false)).json()).toMatchObject({ changed: true });
    expect((await request('repeat', 'a', false)).json()).toMatchObject({ changed: false });
    expect(db.prepare('SELECT id FROM chore_skip_events').all()).toHaveLength(2);
  });
  it('rejects skipping a completed chore without modifying the completion', async () => {
    occurrence('done', 'individual', '2026-10-25');
    const complete = await app.inject({ method: 'PUT', url: '/api/chores/done/completion', payload: { childId: 'a', completed: true } });
    expect(complete.statusCode).toBe(200);
    const skipped = await request('done', 'a', true);
    expect(skipped.statusCode).toBe(409);
    expect((await columns())[0].chores[0]).toMatchObject({ completed: true, skipped: false });
    expect(db.prepare('SELECT id FROM chore_skip_events').all()).toHaveLength(0);
  });
  it('validates skip payload types and missing each-child target', async () => {
    occurrence('each', 'each', '2026-10-25');
    for (const payload of [{}, { skipped: null }, { skipped: 'yes' }, { skipped: true, childId: 123 }]) {
      const result = await app.inject({ method: 'PUT', url: '/api/chores/each/skip', payload });
      expect(result.statusCode).toBe(400);
    }
    const missingChild = await app.inject({ method: 'PUT', url: '/api/chores/each/skip', payload: { skipped: true } });
    expect(missingChild.statusCode).toBe(404);
  });
  it('allows skipping a shared either-child occurrence only once', async () => {
    saveOccurrence(db, { id: 'shared', key: 'shared', choreId: 'task', mode: 'either',
      startsOn: '2026-10-25', dueOn: '2026-10-25', assignees: ['a', 'b'] });
    expect((await request('shared', 'a', true)).statusCode).toBe(200);
    const result = await columns();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('either');
    expect(result[0].chores).toHaveLength(1);
    expect(result[0].chores[0].skipped).toBe(true);
    expect((await request('shared', 'b', false)).json()).toMatchObject({ changed: true });
    expect((await columns())[0].chores[0].skipped).toBe(false);
  });
  it('keeps a skipped chore due today visible without completing it', async () => {
    occurrence('today', 'individual', '2026-10-25');
    expect((await request('today', 'a', true)).statusCode).toBe(200);
    expect((await columns())[0].chores[0]).toMatchObject({ skipped: true, completed: false });
    expect((await request('today', 'a', false)).statusCode).toBe(200);
    expect((await columns())[0].chores[0].skipped).toBe(false);
    expect(db.prepare('SELECT id FROM chore_skip_events').all()).toHaveLength(2);
  });
  it('removes an overdue skip only for the selected child', async () => {
    occurrence('overdue', 'each', '2026-10-24');
    await request('overdue', 'a', true);
    expect((await columns()).map(column => column.id)).toEqual(['b']);
    await request('overdue', 'a', false);
    expect((await columns()).map(column => column.id)).toEqual(['a','b']);
  });
  it('rejects invalid or contradictory changes', async () => {
    occurrence('today', 'individual', '2026-10-25');
    expect((await request('today', 'b', true)).statusCode).toBe(404);
    expect((await request('missing', 'a', true)).statusCode).toBe(404);
    await request('today', 'a', true);
    const complete = await app.inject({ method: 'PUT', url: '/api/chores/today/completion', payload: { childId: 'a', completed: true } });
    expect(complete.statusCode).toBe(409);
  });
});
