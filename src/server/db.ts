import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const migrations = [
  `CREATE TABLE children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
  );
  CREATE TABLE chores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
  );
  CREATE TABLE chore_schedules (
    id TEXT PRIMARY KEY,
    chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE RESTRICT,
    mode TEXT NOT NULL CHECK(mode IN ('individual','either','each')),
    frequency TEXT NOT NULL CHECK(frequency IN ('once','daily','weekly','interval_days','interval_weeks')),
    interval_count INTEGER NOT NULL DEFAULT 1 CHECK(interval_count > 0),
    weekdays TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(weekdays)),
    anchor_date TEXT NOT NULL CHECK(anchor_date GLOB '????-??-??'),
    end_date TEXT CHECK(end_date IS NULL OR end_date GLOB '????-??-??'),
    rotation TEXT NOT NULL DEFAULT 'none' CHECK(rotation IN ('none','daily','weekly')),
    paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
    CHECK(end_date IS NULL OR end_date >= anchor_date)
  );
  CREATE TABLE schedule_assignees (
    schedule_id TEXT NOT NULL REFERENCES chore_schedules(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
    rotation_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(schedule_id, child_id),
    UNIQUE(schedule_id, rotation_order)
  );
  CREATE TABLE chore_occurrences (
    id TEXT PRIMARY KEY,
    schedule_id TEXT REFERENCES chore_schedules(id) ON DELETE RESTRICT,
    chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE RESTRICT,
    occurrence_key TEXT NOT NULL UNIQUE,
    starts_on TEXT NOT NULL CHECK(starts_on GLOB '????-??-??'),
    due_on TEXT NOT NULL CHECK(due_on GLOB '????-??-??'),
    mode TEXT NOT NULL CHECK(mode IN ('individual','either','each')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','skipped')),
    CHECK(due_on >= starts_on)
  );
  CREATE TABLE occurrence_assignees (
    occurrence_id TEXT NOT NULL REFERENCES chore_occurrences(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
    PRIMARY KEY(occurrence_id, child_id)
  );
  CREATE TABLE chore_completions (
    occurrence_id TEXT NOT NULL REFERENCES chore_occurrences(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL DEFAULT '' ,
    completed INTEGER NOT NULL CHECK(completed IN (0,1)),
    performed_by TEXT REFERENCES children(id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(occurrence_id, child_id)
  );
  CREATE TABLE completion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurrence_id TEXT NOT NULL REFERENCES chore_occurrences(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL CHECK(completed IN (0,1)),
    performed_by TEXT REFERENCES children(id) ON DELETE RESTRICT,
    occurred_at TEXT NOT NULL
  );
  CREATE TABLE occurrence_overrides (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES chore_schedules(id) ON DELETE CASCADE,
    original_date TEXT NOT NULL CHECK(original_date GLOB '????-??-??'),
    action TEXT NOT NULL CHECK(action IN ('skip','move','reassign')),
    new_date TEXT CHECK(new_date IS NULL OR new_date GLOB '????-??-??'),
    child_id TEXT REFERENCES children(id) ON DELETE RESTRICT,
    UNIQUE(schedule_id, original_date),
    CHECK((action='move' AND new_date IS NOT NULL) OR (action='reassign' AND child_id IS NOT NULL) OR action='skip')
  );
  CREATE INDEX idx_occurrences_dates ON chore_occurrences(starts_on, due_on);
  CREATE INDEX idx_completion_events_occurrence ON completion_events(occurrence_id);
  CREATE INDEX idx_overrides_schedule ON occurrence_overrides(schedule_id, original_date);`
];

export function openDatabase(filename: string): DatabaseSync {
  if (!filename.trim()) throw new Error('Database filename must not be empty');
  const path = filename === ':memory:' ? filename : resolve(filename);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (let i = 0; i < migrations.length; i++) {
      if (db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(i + 1)) continue;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(migrations[i]);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(i + 1, new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (result.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function backupDatabase(db: DatabaseSync, target: string): void {
  // VACUUM INTO creates a consistent standalone snapshot even in WAL mode.
  // SQLite cannot bind VACUUM INTO in all supported builds; quote path safely.
  const escaped = resolve(target).replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escaped}'`);
}
