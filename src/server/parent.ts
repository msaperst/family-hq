import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { localToday } from './dashboard.js';
import { previewOccurrences } from './recurrence.js';

type Mode = 'individual' | 'either' | 'each';
type Frequency = 'once' | 'daily' | 'weekly' | 'interval_days' | 'interval_weeks';
type Rotation = 'none' | 'daily' | 'weekly';
interface ScheduleInput {
  name: string; mode: Mode; frequency: Frequency; intervalCount: number;
  weekdays: number[]; anchorDate: string; endDate: string | null;
  rotation: Rotation; assignees: string[];
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function validInput(value: unknown): value is ScheduleInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ScheduleInput>;
  return typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 120 &&
    ['individual', 'either', 'each'].includes(v.mode ?? '') &&
    ['once', 'daily', 'weekly', 'interval_days', 'interval_weeks'].includes(v.frequency ?? '') &&
    typeof v.intervalCount === 'number' && Number.isInteger(v.intervalCount) && v.intervalCount >= 1 && v.intervalCount <= 365 &&
    Array.isArray(v.weekdays) && v.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6) &&
    new Set(v.weekdays).size === v.weekdays.length &&
    validDate(v.anchorDate) && (v.endDate === null || validDate(v.endDate)) &&
    (v.endDate === null || v.endDate! >= v.anchorDate!) &&
    ['none', 'daily', 'weekly'].includes(v.rotation ?? '') &&
    Array.isArray(v.assignees) && v.assignees.length > 0 &&
    v.assignees.every(id => typeof id === 'string' && id.length > 0) &&
    new Set(v.assignees).size === v.assignees.length &&
    (v.mode !== 'individual' || v.rotation !== 'none' || v.assignees.length === 1) &&
    (v.rotation === 'none' || v.mode === 'individual') &&
    (v.frequency !== 'weekly' || v.weekdays.length > 0 || v.intervalCount === 1);
}
function validChildName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80;
}
function validChildPatch(input: unknown): input is { name?: string; active?: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const fields = Object.keys(input);
  if (fields.length !== 1) return false;
  const value = input as { name?: unknown; active?: unknown };
  return fields[0] === 'name' ? validChildName(value.name)
    : fields[0] === 'active' && typeof value.active === 'boolean';
}
export function registerParentApi(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/parent/children', () => ({
    children: db.prepare('SELECT id, name, active FROM children ORDER BY name').all(),
  }));
  app.post<{ Body: { name?: string } }>('/api/parent/children', (request, reply) => {
    if (!validChildName(request.body?.name)) return reply.code(400).send({ error: 'Enter a name (80 characters or fewer)' });
    const name = request.body.name.trim();
    if (db.prepare('SELECT id FROM children WHERE name = ? COLLATE NOCASE').get(name))
      return reply.code(409).send({ error: 'A child with this name already exists' });
    const id = randomUUID();
    db.prepare('INSERT INTO children (id, name) VALUES (?, ?)').run(id, name);
    return reply.code(201).send({ id, name, active: true });
  });
  app.patch<{ Params: { id: string }; Body: { name?: string; active?: boolean } }>('/api/parent/children/:id', (request, reply) => {
    const input = request.body;
    if (!validChildPatch(input))
      return reply.code(400).send({ error: 'Provide a valid name or active status' });
    const existing = db.prepare('SELECT id, name, active FROM children WHERE id = ?').get(request.params.id) as
      { id: string; name: string; active: number } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Child not found' });
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (db.prepare('SELECT id FROM children WHERE name = ? COLLATE NOCASE AND id != ?').get(name, existing.id))
        return reply.code(409).send({ error: 'A child with this name already exists' });
      db.prepare('UPDATE children SET name = ? WHERE id = ?').run(name, existing.id);
      return { id: existing.id, name, active: Boolean(existing.active) };
    }
    if (input.active === false && existing.active) {
      const activeSchedule = db.prepare(`SELECT 1 FROM schedule_assignees a
        JOIN chore_schedules s ON s.id = a.schedule_id
        WHERE a.child_id = ? AND s.paused = 0 LIMIT 1`).get(existing.id);
      if (activeSchedule) return reply.code(409).send({
        error: 'Pause or reassign active schedules before deactivating this child',
      });
    }
    db.prepare('UPDATE children SET active = ? WHERE id = ?').run(Number(input.active), existing.id);
    return { id: existing.id, name: existing.name, active: input.active };
  });
  app.delete<{ Params: { id: string } }>('/api/parent/children/:id', (request, reply) => {
    const id = request.params.id;
    if (!db.prepare('SELECT id FROM children WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Child not found' });
    // Deletion is only safe for unused child records; historical data must be retained.
    const references: [string, string][] = [
      ['schedule_assignees', 'child_id'],
      ['occurrence_assignees', 'child_id'],
      ['chore_completions', 'performed_by'],
      ['completion_events', 'performed_by'],
      ['occurrence_overrides', 'child_id'],
    ];
    if (references.some(([table, column]) =>
      db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(id)))
      return reply.code(409).send({ error: 'This child has chore history or assignments; deactivate instead of deleting' });
    db.prepare('DELETE FROM children WHERE id = ?').run(id);
    return reply.code(204).send();
  });
  app.get('/api/parent/schedules', () => {
    const rows = db.prepare(`SELECT s.*, c.name FROM chore_schedules s
      JOIN chores c ON c.id = s.chore_id ORDER BY c.name, s.id`).all();
    return { schedules: rows.map(row => {
      const s = row as Record<string, unknown>;
      const assignees = db.prepare('SELECT child_id FROM schedule_assignees WHERE schedule_id = ? ORDER BY rotation_order').all(s.id as string) as { child_id: string }[];
      return { id: s.id, choreId: s.chore_id, name: s.name, mode: s.mode, frequency: s.frequency,
        intervalCount: s.interval_count, weekdays: JSON.parse(s.weekdays as string), anchorDate: s.anchor_date,
        endDate: s.end_date, rotation: s.rotation, paused: Boolean(s.paused), assignees: assignees.map(a => a.child_id) };
    }) };
  });
  app.post<{ Body: ScheduleInput }>('/api/parent/schedules', (request, reply) => {
    if (!validInput(request.body)) return reply.code(400).send({ error: 'Invalid schedule' });
    const input = request.body;
    const known = db.prepare(`SELECT id FROM children WHERE active = 1`).all() as { id: string }[];
    if (input.assignees.some(id => !known.some(child => child.id === id))) return reply.code(400).send({ error: 'Unknown or inactive child' });
    const id = randomUUID(), choreId = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO chores (id, name) VALUES (?, ?)').run(choreId, input.name.trim());
      db.prepare(`INSERT INTO chore_schedules
        (id, chore_id, mode, frequency, interval_count, weekdays, anchor_date, end_date, rotation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, choreId, input.mode, input.frequency, input.intervalCount, JSON.stringify(input.weekdays),
          input.anchorDate, input.endDate, input.rotation);
      const assign = db.prepare('INSERT INTO schedule_assignees (schedule_id, child_id, rotation_order) VALUES (?, ?, ?)');
      input.assignees.forEach((child, index) => assign.run(id, child, index));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return reply.code(201).send({ id, choreId });
  });

  app.put<{ Params: { id: string }; Body: ScheduleInput }>('/api/parent/schedules/:id', (request, reply) => {
    if (!validInput(request.body)) return reply.code(400).send({ error: 'Invalid schedule' });
    const input = request.body;
    const existing = db.prepare('SELECT chore_id FROM chore_schedules WHERE id = ?').get(request.params.id) as { chore_id: string } | undefined;
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' });
    const known = db.prepare('SELECT id FROM children WHERE active = 1').all() as { id: string }[];
    if (input.assignees.some(id => !known.some(child => child.id === id))) return reply.code(400).send({ error: 'Unknown or inactive child' });
    // Reconcile untouched future occurrences, retaining history and completions.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`DELETE FROM chore_occurrences WHERE schedule_id = ? AND due_on >= ?
        AND NOT EXISTS (SELECT 1 FROM chore_completions WHERE occurrence_id = chore_occurrences.id)
        AND NOT EXISTS (SELECT 1 FROM completion_events WHERE occurrence_id = chore_occurrences.id)`)
        .run(request.params.id, localToday());
      db.prepare('UPDATE chores SET name = ? WHERE id = ?').run(input.name.trim(), existing.chore_id);
      db.prepare(`UPDATE chore_schedules SET mode = ?, frequency = ?, interval_count = ?, weekdays = ?,
        anchor_date = ?, end_date = ?, rotation = ? WHERE id = ?`)
        .run(input.mode, input.frequency, input.intervalCount, JSON.stringify(input.weekdays),
          input.anchorDate, input.endDate, input.rotation, request.params.id);
      db.prepare('DELETE FROM schedule_assignees WHERE schedule_id = ?').run(request.params.id);
      const assign = db.prepare('INSERT INTO schedule_assignees (schedule_id, child_id, rotation_order) VALUES (?, ?, ?)');
      input.assignees.forEach((child, index) => assign.run(request.params.id, child, index));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { id: request.params.id, updated: true };
  });

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>('/api/parent/schedules/:id/preview', (request, reply) => {
    if (!db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(request.params.id))
      return reply.code(404).send({ error: 'Schedule not found' });
    const from = request.query.from ?? localToday();
    if (!validDate(from)) return reply.code(400).send({ error: 'Invalid preview date range' });
    const to = request.query.to ?? new Date(Date.parse(from + 'T00:00:00Z') + 28 * 86400000).toISOString().slice(0, 10);
    if (!validDate(from) || !validDate(to) || to < from ||
        (Date.parse(to) - Date.parse(from)) / 86400000 > 366)
      return reply.code(400).send({ error: 'Invalid preview date range' });
    return { occurrences: previewOccurrences(db, request.params.id, from, to) };
  });
  app.get<{ Params: { id: string } }>('/api/parent/schedules/:id/exceptions', (request, reply) => {
    if (!db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(request.params.id))
      return reply.code(404).send({ error: 'Schedule not found' });
    return { exceptions: db.prepare(`SELECT original_date AS originalDate, action,
      new_date AS newDate, child_id AS childId FROM occurrence_overrides
      WHERE schedule_id = ? ORDER BY original_date`).all(request.params.id) };
  });
  app.put<{ Params: { id: string; date: string }; Body: { action: 'skip' | 'move' | 'reassign'; newDate?: string; childId?: string } }>(
    '/api/parent/schedules/:id/exceptions/:date', (request, reply) => {
      const { id, date } = request.params;
      const input = request.body;
      if (!validDate(date) || !input || !['skip', 'move', 'reassign'].includes(input.action) ||
          (input.action === 'move' && (!validDate(input.newDate) || input.newDate < localToday())) ||
          (input.action === 'reassign' && (typeof input.childId !== 'string' ||
            !db.prepare('SELECT id FROM children WHERE id = ? AND active = 1').get(input.childId))) ||
          (input.action === 'skip' && (input.newDate !== undefined || input.childId !== undefined)) ||
          (input.action === 'move' && input.childId !== undefined) ||
          (input.action === 'reassign' && input.newDate !== undefined))
        return reply.code(400).send({ error: 'Invalid exception' });
      if (date < localToday()) return reply.code(400).send({ error: 'Past occurrences cannot be changed' });
      if (!db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(id))
        return reply.code(404).send({ error: 'Schedule not found' });
      const occurrence = db.prepare('SELECT id FROM chore_occurrences WHERE schedule_id = ? AND occurrence_key = ?')
        .get(id, id + ':' + date) as { id: string } | undefined;
      if (occurrence && (db.prepare('SELECT 1 FROM chore_completions WHERE occurrence_id = ?').get(occurrence.id) ||
          db.prepare('SELECT 1 FROM completion_events WHERE occurrence_id = ?').get(occurrence.id)))
        return reply.code(409).send({ error: 'Cannot change an occurrence with completion history' });
      db.exec('BEGIN IMMEDIATE');
      try {
        if (occurrence) db.prepare('DELETE FROM chore_occurrences WHERE id = ?').run(occurrence.id);
        db.prepare(`INSERT INTO occurrence_overrides (id, schedule_id, original_date, action, new_date, child_id)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(schedule_id, original_date) DO UPDATE SET
          action = excluded.action, new_date = excluded.new_date, child_id = excluded.child_id`)
          .run(randomUUID(), id, date, input.action, input.action === 'move' ? input.newDate! : null,
            input.action === 'reassign' ? input.childId! : null);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { originalDate: date, action: input.action };
    },
  );
  app.delete<{ Params: { id: string; date: string } }>('/api/parent/schedules/:id/exceptions/:date', (request, reply) => {
    const { id, date } = request.params;
    if (!validDate(date) || date < localToday()) return reply.code(400).send({ error: 'Invalid exception date' });
    if (!db.prepare('SELECT id FROM chore_schedules WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Schedule not found' });
    const occurrence = db.prepare('SELECT id FROM chore_occurrences WHERE schedule_id = ? AND occurrence_key = ?')
      .get(id, id + ':' + date) as { id: string } | undefined;
    if (occurrence && (db.prepare('SELECT 1 FROM chore_completions WHERE occurrence_id = ?').get(occurrence.id) ||
        db.prepare('SELECT 1 FROM completion_events WHERE occurrence_id = ?').get(occurrence.id)))
      return reply.code(409).send({ error: 'Cannot change an occurrence with completion history' });
    db.exec('BEGIN IMMEDIATE');
    try {
      if (occurrence) db.prepare('DELETE FROM chore_occurrences WHERE id = ?').run(occurrence.id);
      const result = db.prepare('DELETE FROM occurrence_overrides WHERE schedule_id = ? AND original_date = ?').run(id, date);
      db.exec('COMMIT');
      return { removed: result.changes > 0 };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  app.patch<{ Params: { id: string }; Body: { paused?: boolean } }>('/api/parent/schedules/:id', (request, reply) => {
    if (!request.body || typeof request.body.paused !== 'boolean' || Object.keys(request.body).length !== 1)
      return reply.code(400).send({ error: 'Invalid schedule update' });
    const result = db.prepare('UPDATE chore_schedules SET paused = ? WHERE id = ?').run(Number(request.body.paused), request.params.id);
    if (!result.changes) return reply.code(404).send({ error: 'Schedule not found' });
    return { id: request.params.id, paused: request.body.paused };
  });
}
