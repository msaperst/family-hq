import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, backupDatabase } from '../../src/server/db';
import { addChild, addChore, saveOccurrence, setCompletion, getCompletion } from '../../src/server/chores';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture() {
  const db = openDatabase(':memory:');
  addChild(db, 'porter', 'Porter');
  addChild(db, 'miller', 'Miller');
  addChore(db, 'task', 'Task');
  return db;
}
const base = { id: 'today', key: 'task:today', choreId: 'task', startsOn: '2026-10-14', dueOn: '2026-10-14', mode: 'either' as const, assignees: ['porter', 'miller'] };
describe('persistence failure and boundary paths', () => {
  it('rejects empty and duplicate assignees without inserting anything', () => {
    const db = fixture();
    try {
      expect(() => saveOccurrence(db, { ...base, assignees: [] })).toThrow('Distinct assignees');
      expect(() => saveOccurrence(db, { ...base, assignees: ['porter', 'porter'] })).toThrow('Distinct assignees');
      expect((db.prepare('SELECT count(*) AS n FROM chore_occurrences').get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });
  it('rejects invalid individual assignments and reversed dates', () => {
    const db = fixture();
    try {
      expect(() => saveOccurrence(db, { ...base, mode: 'individual', assignees: ['porter', 'miller'] })).toThrow('one assignee');
      expect(() => saveOccurrence(db, { ...base, startsOn: '2026-10-15' })).toThrow('Invalid occurrence date');
    } finally { db.close(); }
  });
  it('rolls back an occurrence when an assignee violates a foreign key', () => {
    const db = fixture();
    try {
      expect(() => saveOccurrence(db, { ...base, assignees: ['porter', 'unknown'] })).toThrow();
      expect((db.prepare('SELECT count(*) AS n FROM chore_occurrences').get() as { n: number }).n).toBe(0);
      saveOccurrence(db, base);
      expect((db.prepare('SELECT count(*) AS n FROM occurrence_assignees').get() as { n: number }).n).toBe(2);
    } finally { db.close(); }
  });
  it('rejects conflicting occurrence metadata without overwriting stored data', () => {
    const db = fixture();
    try {
      saveOccurrence(db, base);
      expect(() => saveOccurrence(db, { ...base, dueOn: '2026-10-15' })).toThrow('key conflict');
      expect((db.prepare('SELECT due_on FROM chore_occurrences WHERE id = ?').get('today') as { due_on: string }).due_on).toBe('2026-10-14');
    } finally { db.close(); }
  });
  it('rejects missing and skipped occurrences without recording events', () => {
    const db = fixture();
    try {
      expect(() => setCompletion(db, 'missing', null, true)).toThrow('Active occurrence');
      saveOccurrence(db, base);
      db.prepare("UPDATE chore_occurrences SET status = 'skipped' WHERE id = ?").run('today');
      expect(() => setCompletion(db, 'today', null, true)).toThrow('Active occurrence');
      expect((db.prepare('SELECT count(*) AS n FROM completion_events').get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });
  it('rejects invalid completion target and invalid performer', () => {
    const db = fixture();
    try {
      saveOccurrence(db, { ...base, mode: 'each' });
      expect(() => setCompletion(db, 'today', null, true)).toThrow('Invalid completion target');
      expect(() => setCompletion(db, 'today', 'unknown', true)).toThrow('Invalid completion target');
      expect(() => setCompletion(db, 'today', 'porter', true, 'unknown')).toThrow('Performer');
      expect(getCompletion(db, 'today', 'porter')).toBe(false);
    } finally { db.close(); }
  });
  it('rejects a non-assignee for an individual chore', () => {
    const db = fixture();
    try {
      saveOccurrence(db, { ...base, mode: 'individual', assignees: ['porter'] });
      expect(() => setCompletion(db, 'today', 'miller', true)).toThrow('Invalid assignee');
      expect(setCompletion(db, 'today', 'porter', true)).toBe(true);
    } finally { db.close(); }
  });
  it('returns no change for an initially unchecked task and supports reversal', () => {
    const db = fixture();
    try {
      saveOccurrence(db, base);
      expect(setCompletion(db, 'today', null, false)).toBe(false);
      expect(setCompletion(db, 'today', null, true)).toBe(true);
      expect(setCompletion(db, 'today', null, false)).toBe(true);
      expect(setCompletion(db, 'today', null, false)).toBe(false);
      expect((db.prepare('SELECT count(*) AS n FROM completion_events').get() as { n: number }).n).toBe(2);
    } finally { db.close(); }
  });
  it('rejects querying nonexistent occurrences and missing each-child targets', () => {
    const db = fixture();
    try {
      expect(() => getCompletion(db, 'missing')).toThrow('Occurrence not found');
      saveOccurrence(db, { ...base, mode: 'each' });
      expect(() => getCompletion(db, 'today')).toThrow('Child required');
    } finally { db.close(); }
  });
  it('rejects an empty database path', () => {
    expect(() => openDatabase(' ')).toThrow('must not be empty');
  });
  it('rolls back a failed migration without recording its version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'family-hq-migration-'));
    const path = join(dir, 'migration.sqlite');
    try {
      const seed = new DatabaseSync(path);
      seed.exec('CREATE TABLE children (id TEXT PRIMARY KEY)');
      seed.close();
      expect(() => openDatabase(path)).toThrow();
      const inspect = new DatabaseSync(path);
      try {
        expect((inspect.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(0);
        expect((inspect.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'chores'").get() as { n: number }).n).toBe(0);
      } finally { inspect.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects corrupted files rather than treating them as new databases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'family-hq-corrupt-'));
    try {
      const path = join(dir, 'broken.sqlite');
      writeFileSync(path, 'not a sqlite database');
      expect(() => openDatabase(path)).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not overwrite an existing snapshot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'family-hq-backup-'));
    const db = fixture();
    try {
      const target = join(dir, 'snapshot.sqlite');
      backupDatabase(db, target);
      expect(() => backupDatabase(db, target)).toThrow();
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
