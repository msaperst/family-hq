import type { DatabaseSync } from 'node:sqlite';
import type { CompletionMode } from './chores.js';
import { saveOccurrence } from './chores.js';

type Frequency = 'once' | 'daily' | 'weekly' | 'interval_days' | 'interval_weeks';
type Rotation = 'none' | 'daily' | 'weekly';
interface Schedule {
  id: string; chore_id: string; mode: CompletionMode; frequency: Frequency;
  interval_count: number; weekdays: string; anchor_date: string; end_date: string | null;
  rotation: Rotation; paused: number;
}
interface Override { original_date: string; action: 'skip' | 'move' | 'reassign'; new_date: string | null; child_id: string | null }
export interface GeneratedOccurrence {
  id: string; key: string; choreId: string; scheduleId: string;
  startsOn: string; dueOn: string; mode: CompletionMode; assignees: string[]; skipped: boolean;
}
const DAY_MS = 86_400_000;
function parseDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid local date');
  const value = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Invalid local date');
  return value / DAY_MS;
}
function formatDate(day: number): string { return new Date(day * DAY_MS).toISOString().slice(0, 10); }
function monday(day: number): number { return day - (new Date(day * DAY_MS).getUTCDay() + 6) % 7; }
function weekday(day: number): number { return (new Date(day * DAY_MS).getUTCDay() + 6) % 7; }
function weekdaysOf(schedule: Schedule): number[] {
  const raw: unknown = JSON.parse(schedule.weekdays);
  if (!Array.isArray(raw) || raw.some(x => !Number.isInteger(x) || x < 0 || x > 6)) throw new Error('Weekdays must be 0 (Monday) through 6 (Sunday)');
  const unique = new Set(raw as number[]);
  return Array.from(unique);
}
function due(schedule: Schedule, day: number, anchor: number, weekdays: number[]): boolean {
  if (day < anchor || (schedule.end_date !== null && day > parseDate(schedule.end_date))) return false;
  const delta = day - anchor;
  switch (schedule.frequency) {
    case 'once': return day === anchor;
    case 'daily': return weekdays.length === 0 || weekdays.includes(weekday(day));
    case 'weekly': return weekdays.includes(weekday(day));
    case 'interval_days': return delta % schedule.interval_count === 0 && (weekdays.length === 0 || weekdays.includes(weekday(day)));
    case 'interval_weeks': return (monday(day) - monday(anchor)) / 7 % schedule.interval_count === 0 &&
      (weekdays.length === 0 ? weekday(day) === weekday(anchor) : weekdays.includes(weekday(day)));
  }
}
export function previewOccurrences(db: DatabaseSync, scheduleId: string, from: string, to: string): GeneratedOccurrence[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (end < start || end - start > 366) throw new Error('Date range must span 0–366 days');
  const schedule = db.prepare('SELECT * FROM chore_schedules WHERE id = ?').get(scheduleId) as unknown as Schedule | undefined;
  if (!schedule) throw new Error('Schedule not found');
  if (schedule.paused) return [];
  if (schedule.interval_count < 1) throw new Error('Invalid interval');
  const anchor = parseDate(schedule.anchor_date);
  const weekdays = weekdaysOf(schedule);
  const children = (db.prepare('SELECT child_id FROM schedule_assignees WHERE schedule_id = ? ORDER BY rotation_order').all(scheduleId) as unknown as {child_id:string}[]).map(x => x.child_id);
  if (children.length === 0 || (schedule.mode === 'individual' && schedule.rotation === 'none' && children.length !== 1)) throw new Error('Invalid schedule assignees');
  const overrides = new Map((db.prepare('SELECT original_date, action, new_date, child_id FROM occurrence_overrides WHERE schedule_id = ?').all(scheduleId) as unknown as Override[]).map(x => [x.original_date, x]));
  const results: GeneratedOccurrence[] = [];
  // Include original dates of overrides moved into this query window, even if
  // those dates lie outside the requested window. The original date remains
  // the stable occurrence identity.
  const movedOrigins = new Set<number>();
  for (const exception of overrides.values()) {
    if (exception.action !== 'move' || !exception.new_date) continue;
    const target = parseDate(exception.new_date);
    const finish = schedule.frequency === 'weekly' && weekdays.length === 0 ? target + 6 : target;
    if (target <= end && finish >= start) movedOrigins.add(parseDate(exception.original_date));
  }
  // Weekly flexible: one obligation for each Monday–Sunday week, not seven daily obligations.
  const flexible = schedule.frequency === 'weekly' && weekdays.length === 0;
  const first = flexible ? monday(start) : start;
  const days = new Set<number>();
  for (let day = first; day <= end; day += flexible ? 7 : 1) days.add(day);
  for (const origin of movedOrigins) days.add(origin);
  for (const day of [...days].sort((a, b) => a - b)) {
    const origin = formatDate(day);
    if (flexible) {
      // Flexible-week origins are generated on Mondays.
      if (day + 6 < anchor || (schedule.end_date && day > parseDate(schedule.end_date))) continue;
    } else if (!due(schedule, day, anchor, weekdays)) continue;
    const exception = overrides.get(origin);
    const moved = exception?.action === 'move' && exception.new_date ? parseDate(exception.new_date) : day;
    const begin = moved;
    const finish = flexible ? moved + 6 : moved;
    if (finish < start || begin > end) continue;
    const index = schedule.rotation === 'weekly' ? Math.floor((monday(day) - monday(anchor)) / 7) : day - anchor;
    const assignees = schedule.rotation === 'none' ? [...children] : [children[((index % children.length) + children.length) % children.length]];
    if (exception?.action === 'reassign' && exception.child_id) assignees.splice(0, assignees.length, exception.child_id);
    results.push({
      id: schedule.id + ':' + origin, key: schedule.id + ':' + origin,
      choreId: schedule.chore_id, scheduleId: schedule.id,
      startsOn: formatDate(begin), dueOn: formatDate(finish),
      mode: schedule.rotation === 'none' ? schedule.mode : 'individual',
      assignees, skipped: exception?.action === 'skip',
    });
  }
  return results;
}
export function generateOccurrences(db: DatabaseSync, scheduleId: string, from: string, to: string): GeneratedOccurrence[] {
  const entries = previewOccurrences(db, scheduleId, from, to);
  for (const entry of entries) {
    const { skipped, ...input } = entry;
    saveOccurrence(db, input);
    if (skipped) db.prepare("UPDATE chore_occurrences SET status = 'skipped' WHERE id = ? AND status = 'active'").run(entry.id);
  }
  return entries;
}
