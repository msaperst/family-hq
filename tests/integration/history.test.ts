import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db';
import { addChild, addChore, saveOccurrence, setCompletion, setSkipped } from '../../src/server/chores';
import { choreHistory } from '../../src/server/history';
import { buildApp } from '../../src/server/app';
import { summarizeHistory } from '../../src/shared/history';

describe('chore history reporting', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    db = openDatabase(':memory:');
    app = buildApp({ db });
    addChild(db, 'one', 'Child One');
    addChild(db, 'two', 'Child Two');
    addChore(db, 'chores', 'Dishes');
  });
  afterEach(async () => { await app.close(); db.close(); });
  function add(id: string, date: string, mode: 'individual' | 'each' | 'either', assignees = ['one']) {
    saveOccurrence(db, { id, key: id, choreId: 'chores', startsOn: date, dueOn: date, mode, assignees });
  }
  it('counts completed, skipped, and pending without double counting either-child chores', () => {
    add('done', '2026-10-25', 'individual');
    add('skip', '2026-10-25', 'individual');
    add('shared', '2026-10-25', 'either', ['one', 'two']);
    add('each', '2026-10-25', 'each', ['one', 'two']);
    setCompletion(db, 'done', 'one', true);
    setSkipped(db, 'skip', 'one', true);
    setCompletion(db, 'each', 'one', true);
    const result = choreHistory(db, 7, '2026-10-26');
    expect(summarizeHistory(result.entries)).toEqual({ total: 5, completed: 2, skipped: 1, outstanding: 2 });
    expect(result.entries.filter(e => e.id === 'shared')).toHaveLength(1);
  });
  it('does not include occurrences outside the requested range', () => {
    add('older', '2026-09-01', 'individual');
    add('current', '2026-10-26', 'individual');
    expect(choreHistory(db, 7, '2026-10-26').entries.map(e => e.id)).toEqual(['current']);
    expect(choreHistory(db, 30, '2026-10-26').entries).toHaveLength(1);
  });
  it('reflects undo and changing outcomes rather than historical event counts', () => {
    add('transition', '2026-10-26', 'individual');
    setSkipped(db, 'transition', 'one', true);
    expect(choreHistory(db, 7, '2026-10-26').entries[0].status).toBe('skipped');
    setSkipped(db, 'transition', 'one', false);
    expect(choreHistory(db, 7, '2026-10-26').entries[0].status).toBe('outstanding');
    setCompletion(db, 'transition', 'one', true);
    expect(choreHistory(db, 7, '2026-10-26').entries[0].status).toBe('completed');
    setCompletion(db, 'transition', 'one', false);
    expect(choreHistory(db, 7, '2026-10-26').entries[0].status).toBe('outstanding');
  });
  it('includes 7-day boundary dates and excludes tomorrow', () => {
    add('first', '2026-10-20', 'individual');
    add('tomorrow', '2026-10-27', 'individual');
    expect(choreHistory(db, 7, '2026-10-26').entries.map(entry => entry.id)).toEqual(['first']);
  });
  it('exposes a validated read-only API for both date ranges', async () => {
    add('due', '2026-10-26', 'individual');
    expect((await app.inject({ method: 'GET', url: '/api/history?days=7' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/history?days=30' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/history?days=100' })).statusCode).toBe(400);
  });
});
