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
