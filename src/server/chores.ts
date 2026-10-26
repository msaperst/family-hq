import type { DatabaseSync } from 'node:sqlite';

export type CompletionMode = 'individual' | 'either' | 'each';
export interface OccurrenceInput {
  id: string;
  key: string;
  choreId: string;
  scheduleId?: string;
  startsOn: string;
  dueOn: string;
  mode: CompletionMode;
  assignees: string[];
}
function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function addChild(db: DatabaseSync, id: string, name: string): void {
  db.prepare('INSERT INTO children (id, name) VALUES (?, ?)').run(id, name);
}
export function addChore(db: DatabaseSync, id: string, name: string): void {
  db.prepare('INSERT INTO chores (id, name) VALUES (?, ?)').run(id, name);
}
export function saveOccurrence(db: DatabaseSync, input: OccurrenceInput): void {
  if (!input.assignees.length || new Set(input.assignees).size !== input.assignees.length) throw new Error('Distinct assignees required');
  if (input.mode === 'individual' && input.assignees.length !== 1) throw new Error('Individual chores require one assignee');
  if (input.startsOn > input.dueOn) throw new Error('Invalid occurrence date range');
  transaction(db, () => {
    db.prepare(`INSERT INTO chore_occurrences
      (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(occurrence_key) DO NOTHING`)
      .run(input.id, input.key, input.choreId, input.scheduleId ?? null, input.startsOn, input.dueOn, input.mode);
    const existing = db.prepare('SELECT id, chore_id, schedule_id, mode, starts_on, due_on FROM chore_occurrences WHERE occurrence_key = ?').get(input.key) as
      { id: string; chore_id: string; schedule_id: string | null; mode: string; starts_on: string; due_on: string };
    if (existing.id !== input.id || existing.chore_id !== input.choreId || existing.mode !== input.mode ||
      existing.starts_on !== input.startsOn || existing.due_on !== input.dueOn) {
      const differences = {
        id: { stored: existing.id, generated: input.id },
        choreId: { stored: existing.chore_id, generated: input.choreId },
        scheduleId: { stored: existing.schedule_id, generated: input.scheduleId ?? null },
        mode: { stored: existing.mode, generated: input.mode },
        startsOn: { stored: existing.starts_on, generated: input.startsOn },
        dueOn: { stored: existing.due_on, generated: input.dueOn },
      };
      const changed = Object.fromEntries(Object.entries(differences).filter(([, values]) => values.stored !== values.generated));
      throw new Error('Occurrence key conflict: existing occurrence differs; key=' + input.key +
        '; scheduleId=' + (input.scheduleId ?? 'none') + '; differences=' + JSON.stringify(changed));
    }
    const add = db.prepare('INSERT OR IGNORE INTO occurrence_assignees (occurrence_id, child_id) VALUES (?, ?)');
    for (const child of input.assignees) add.run(input.id, child);
    const actual = (db.prepare('SELECT child_id FROM occurrence_assignees WHERE occurrence_id = ?').all(input.id) as { child_id: string }[]).map(x => x.child_id).sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(actual) !== JSON.stringify([...input.assignees].sort((a, b) => a.localeCompare(b)))) throw new Error('Occurrence assignees conflict; key=' + input.key + '; scheduleId=' + (input.scheduleId ?? 'none') + '; stored=' + JSON.stringify(actual) + '; generated=' + JSON.stringify([...input.assignees].sort((a, b) => a.localeCompare(b))));
  });
}
export function setCompletion(db: DatabaseSync, occurrenceId: string, childId: string | null, completed: boolean, performedBy: string | null = null): boolean {
  return transaction(db, () => {
    const occurrence = db.prepare('SELECT mode, status FROM chore_occurrences WHERE id = ?').get(occurrenceId) as
      { mode: CompletionMode; status: string } | undefined;
    if (occurrence?.status !== 'active') throw new Error('Active occurrence not found');
    const assignees = new Set((db.prepare('SELECT child_id FROM occurrence_assignees WHERE occurrence_id = ?').all(occurrenceId) as { child_id: string }[]).map(x => x.child_id));
    const key = occurrence.mode === 'each' ? childId : '';
    if (key === null || (occurrence.mode === 'each' && !assignees.has(key))) throw new Error('Invalid completion target');
    if (performedBy !== null && !assignees.has(performedBy)) throw new Error('Performer must be an assignee');
    if (occurrence.mode === 'individual' && childId !== null && !assignees.has(childId)) throw new Error('Invalid assignee');
    const previous = db.prepare('SELECT completed FROM chore_completions WHERE occurrence_id = ? AND child_id = ?').get(occurrenceId, key) as { completed: number } | undefined;
    if (previous?.completed === Number(completed) || (!previous?.completed && !completed)) return false;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, performed_by, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(occurrence_id, child_id)
      DO UPDATE SET completed=excluded.completed, performed_by=excluded.performed_by, updated_at=excluded.updated_at`)
      .run(occurrenceId, key, Number(completed), completed ? performedBy : null, now);
    db.prepare('INSERT INTO completion_events (occurrence_id, child_id, completed, performed_by, occurred_at) VALUES (?, ?, ?, ?, ?)')
      .run(occurrenceId, key, Number(completed), completed ? performedBy : null, now);
    return true;
  });
}
export function getCompletion(db: DatabaseSync, occurrenceId: string, childId: string | null = null): boolean {
  const occurrence = db.prepare('SELECT mode FROM chore_occurrences WHERE id = ?').get(occurrenceId) as { mode: CompletionMode } | undefined;
  if (!occurrence) throw new Error('Occurrence not found');
  if (occurrence.mode === 'each' && childId === null) throw new Error('Child required for each-child completion');
  const key = occurrence.mode === 'each' ? childId! : '';
  const result = db.prepare('SELECT completed FROM chore_completions WHERE occurrence_id = ? AND child_id = ?').get(occurrenceId, key) as { completed: number } | undefined;
  return result?.completed === 1;
}

export function setSkipped(db: DatabaseSync, occurrenceId: string, childId: string | null, skipped: boolean): boolean {
  return transaction(db, () => {
    const occurrence = db.prepare('SELECT mode, status FROM chore_occurrences WHERE id = ?').get(occurrenceId) as { mode: CompletionMode; status: string } | undefined;
    if (occurrence?.status !== 'active') throw new Error('Active occurrence not found');
    const assignees = new Set((db.prepare('SELECT child_id FROM occurrence_assignees WHERE occurrence_id = ?').all(occurrenceId) as { child_id: string }[]).map(row => row.child_id));
    const key = occurrence.mode === 'each' ? childId : '';
    if (key === null || (occurrence.mode === 'each' && !assignees.has(key)) || (occurrence.mode === 'individual' && childId !== null && !assignees.has(childId))) throw new Error('Invalid skip target');
    const existing = db.prepare('SELECT skipped FROM chore_skips WHERE occurrence_id = ? AND child_id = ?').get(occurrenceId, key) as { skipped: number } | undefined;
    if (Boolean(existing?.skipped) === skipped) return false;
    if (skipped) {
      const complete = db.prepare('SELECT completed FROM chore_completions WHERE occurrence_id = ? AND child_id = ?').get(occurrenceId, key) as { completed: number } | undefined;
      if (complete?.completed) throw new Error('Completed chore cannot be skipped');
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO chore_skips (occurrence_id, child_id, skipped, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(occurrence_id, child_id)
      DO UPDATE SET skipped=excluded.skipped, updated_at=excluded.updated_at`).run(occurrenceId, key, Number(skipped), now);
    db.prepare('INSERT INTO chore_skip_events (occurrence_id, child_id, skipped, occurred_at) VALUES (?, ?, ?, ?)').run(occurrenceId, key, Number(skipped), now);
    return true;
  });
}
