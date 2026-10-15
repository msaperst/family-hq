import type { DatabaseSync } from 'node:sqlite';
import { generateOccurrences } from './recurrence.js';
import type { DashboardChore, DashboardColumn, DashboardResponse, ChildResponse } from '../shared/dashboard.js';

const DAY = 86_400_000;
export function dateOffset(day: string, offset: number): string {
  const time = Date.parse(day + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) throw new Error('Invalid date');
  return new Date(time + offset * DAY).toISOString().slice(0, 10);
}
export function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function children(db: DatabaseSync): ChildResponse[] {
  return db.prepare('SELECT id, name FROM children WHERE active = 1 ORDER BY name').all() as unknown as ChildResponse[];
}
interface OccurrenceRow { id: string; name: string; starts_on: string; due_on: string; mode: DashboardChore['mode']; child_id: string; completed: number }
export function dashboard(db: DatabaseSync, today: string, extraDays = 0): DashboardResponse {
  const through = dateOffset(today, 6 + extraDays);
  // Generate only the requested horizon. Previously generated incomplete occurrences
  // remain in SQLite, even when their original day has passed.
  const schedules = db.prepare('SELECT id FROM chore_schedules WHERE paused = 0').all() as { id: string }[];
  for (const schedule of schedules) generateOccurrences(db, schedule.id, today, through);
  const rows = db.prepare(`
    SELECT o.id, c.name, o.starts_on, o.due_on, o.mode, a.child_id,
           COALESCE(co.completed, 0) AS completed
    FROM chore_occurrences o
    JOIN chores c ON c.id = o.chore_id
    JOIN occurrence_assignees a ON a.occurrence_id = o.id
    LEFT JOIN chore_completions co ON co.occurrence_id = o.id
      AND co.child_id = CASE WHEN o.mode = 'each' THEN a.child_id ELSE '' END
    JOIN children child ON child.id = a.child_id
    LEFT JOIN chore_schedules schedule ON schedule.id = o.schedule_id
    WHERE o.status = 'active' AND c.archived = 0 AND child.active = 1
      AND (schedule.id IS NULL OR schedule.paused = 0)
      AND o.starts_on <= ? AND (o.due_on >= ? OR COALESCE(co.completed, 0) = 0)
    ORDER BY o.due_on, c.name, o.id
  `).all(through, today) as unknown as OccurrenceRow[];
  const active = children(db);
  const columns = new Map<string, DashboardColumn>();
  for (const child of active) columns.set(child.id, { id: child.id, name: child.name, chores: [] });
  const shared: DashboardColumn = { id: 'either', name: 'Either child', chores: [] };
  const seenShared = new Set<string>();
  for (const row of rows) {
    const isShared = row.mode === 'either';
    if (isShared && seenShared.has(row.id)) continue;
    if (isShared) seenShared.add(row.id);
    const target = isShared ? shared : columns.get(row.child_id);
    // SQL joins active children, which should also be keys of columns.
    // Preserve the invariant explicitly for TypeScript and unexpected DB inconsistencies.
    if (!target) throw new Error('Active child missing from dashboard columns: ' + row.child_id);
    target.chores.push({
      id: row.id, name: row.name, startsOn: row.starts_on, dueOn: row.due_on,
      mode: row.mode, childId: isShared ? null : row.child_id, completed: row.completed === 1,
    });
  }
  return { today, through, columns: [...columns.values()].filter(x => x.chores.length > 0).concat(shared.chores.length ? [shared] : []) };
}
