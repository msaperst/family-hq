import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, backupDatabase } from '../../src/server/db';
import { addChild, addChore, getCompletion, saveOccurrence, setCompletion } from '../../src/server/chores';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function file() { const dir = mkdtempSync(join(tmpdir(), 'family-hq-')); dirs.push(dir); return join(dir, 'family.sqlite'); }
function setup(path = ':memory:') {
  const db = openDatabase(path);
  addChild(db, 'alex', 'Alex'); addChild(db, 'sam', 'Sam'); addChore(db, 'shower', 'Shower');
  return db;
}
describe('SQLite persistence', () => {
  it('migrates idempotently and enforces foreign keys', () => {
    const path = file();
    const db = setup(path);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(() => addChore(db, 'shower', 'duplicate')).toThrow();
    db.close();
    const reopened = openDatabase(path);
    expect((reopened.prepare('SELECT COUNT(*) AS count FROM children').get() as { count: number }).count).toBe(2);
    expect((reopened.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count).toBe(2);
    reopened.close();
  });
  it('shares either-child completion, supports uncheck and preserves history', () => {
    const db = setup();
    saveOccurrence(db, { id: 'one', key: 'shared:2026-10-14', choreId: 'shower', startsOn: '2026-10-14', dueOn: '2026-10-14', mode: 'either', assignees: ['alex', 'sam'] });
    expect(setCompletion(db, 'one', 'alex', true, 'alex')).toBe(true);
    expect(getCompletion(db, 'one', 'sam')).toBe(true);
    expect(setCompletion(db, 'one', 'sam', true, 'sam')).toBe(false);
    expect(setCompletion(db, 'one', null, false)).toBe(true);
    expect(getCompletion(db, 'one', 'alex')).toBe(false);
    expect((db.prepare('SELECT COUNT(*) AS count FROM completion_events').get() as { count: number }).count).toBe(2);
    db.close();
  });
  it('tracks each child independently and isolates dates', () => {
    const db = setup();
    for (const date of ['2026-10-14', '2026-10-15']) saveOccurrence(db, {
      id: date, key: 'shower:' + date, choreId: 'shower', startsOn: date, dueOn: date, mode: 'each', assignees: ['alex', 'sam'],
    });
    setCompletion(db, '2026-10-14', 'alex', true, 'alex');
    expect(getCompletion(db, '2026-10-14', 'alex')).toBe(true);
    expect(getCompletion(db, '2026-10-14', 'sam')).toBe(false);
    expect(getCompletion(db, '2026-10-15', 'alex')).toBe(false);
    db.close();
  });
  it('does not duplicate occurrences or overwrite assignments', () => {
    const db = setup();
    const input = { id: 'x', key: 'weekly:2026-10-12', choreId: 'shower', startsOn: '2026-10-12', dueOn: '2026-10-18', mode: 'individual' as const, assignees: ['alex'] };
    saveOccurrence(db, input); saveOccurrence(db, input);
    expect((db.prepare('SELECT COUNT(*) AS count FROM chore_occurrences').get() as { count: number }).count).toBe(1);
    expect(() => saveOccurrence(db, { ...input, assignees: ['sam'] })).toThrow('conflict');
    expect((db.prepare('SELECT COUNT(*) AS count FROM occurrence_assignees').get() as { count: number }).count).toBe(1);
    db.close();
  });
  it('creates a consistent standalone backup from WAL database', () => {
    const path = file();
    const db = setup(path);
    const snapshot = path + '.snapshot';
    backupDatabase(db, snapshot);
    const restored = openDatabase(snapshot);
    expect((restored.prepare('SELECT name FROM children WHERE id = ?').get('alex') as { name: string }).name).toBe('Alex');
    restored.close(); db.close();
  });
});
