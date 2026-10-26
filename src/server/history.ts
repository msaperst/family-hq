import type { DatabaseSync } from 'node:sqlite';
import { generateOccurrences } from './recurrence.js';
import { dateOffset, localToday } from './dashboard.js';
import type { HistoryEntry, HistoryResponse } from '../shared/history.js';

interface HistoryRow {
  id: string; name: string; due_on: string; mode: string;
  child_id: string; child_name: string; completed: number; skipped: number;
}
export function choreHistory(db: DatabaseSync, days: 7 | 30 = 7, today = localToday()): HistoryResponse {
  const from = dateOffset(today, -(days - 1));
  // Fill in scheduled obligations even if nobody opened the dashboard that day.
  const schedules = db.prepare('SELECT id FROM chore_schedules WHERE paused = 0').all() as { id: string }[];
  for (const schedule of schedules) generateOccurrences(db, schedule.id, from, today);
  const rows = db.prepare(`
    SELECT o.id, c.name, o.due_on, o.mode, a.child_id, child.name AS child_name,
      COALESCE(co.completed, 0) AS completed, COALESCE(sk.skipped, 0) AS skipped
    FROM chore_occurrences o
    JOIN chores c ON c.id = o.chore_id
    JOIN occurrence_assignees a ON a.occurrence_id = o.id
    JOIN children child ON child.id = a.child_id
    LEFT JOIN chore_completions co ON co.occurrence_id = o.id
      AND co.child_id = CASE WHEN o.mode = 'each' THEN a.child_id ELSE '' END
    LEFT JOIN chore_skips sk ON sk.occurrence_id = o.id
      AND sk.child_id = CASE WHEN o.mode = 'each' THEN a.child_id ELSE '' END
    WHERE o.due_on BETWEEN ? AND ? AND o.status = 'active'
    ORDER BY o.due_on DESC, child.name, c.name, o.id
  `).all(from, today) as unknown as HistoryRow[];
  const seenShared = new Set<string>();
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    if (row.mode === 'either') {
      if (seenShared.has(row.id)) continue;
      seenShared.add(row.id);
    }
    entries.push({
      id: row.id, name: row.name, dueOn: row.due_on,
      childId: row.mode === 'either' ? 'either' : row.child_id,
      childName: row.mode === 'either' ? 'Either child' : row.child_name,
      status: row.completed ? 'completed' : row.skipped ? 'skipped' : 'outstanding',
    });
  }
  return { from, through: today, today, entries };
}
