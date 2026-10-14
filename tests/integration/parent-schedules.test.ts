import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import { addChild } from '../../src/server/chores.js';

describe('parent schedule API', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    db = openDatabase(':memory:');
    addChild(db, 'porter', 'Porter');
    addChild(db, 'miller', 'Miller');
    app = buildApp({ db });
  });
  afterEach(async () => { await app.close(); db.close(); });
  const payload = {
    name: 'Take out recycling', mode: 'individual', frequency: 'weekly',
    intervalCount: 1, weekdays: [0], anchorDate: '2026-10-12',
    endDate: null, rotation: 'none', assignees: ['porter'],
  };
  it('creates and lists a recurring schedule with its assignees', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({ method: 'GET', url: '/api/parent/schedules' });
    expect(listed.json().schedules).toEqual([expect.objectContaining({
      id: created.json().id, name: payload.name, assignees: ['porter'], weekdays: [0], paused: false,
    })]);
  });
  it('pauses and resumes without deleting the schedule', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const url = '/api/parent/schedules/' + created.json().id;
    expect((await app.inject({ method: 'PATCH', url, payload: { paused: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/parent/schedules' })).json().schedules[0].paused).toBe(true);
    expect((await app.inject({ method: 'PATCH', url, payload: { paused: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/parent/schedules' })).json().schedules[0].paused).toBe(false);
  });
  it('rejects invalid dates, duplicate children, unknown children and invalid assignments', async () => {
    for (const change of [
      { anchorDate: '2026-02-30' }, { assignees: ['porter', 'porter'] },
      { assignees: ['missing'] }, { assignees: ['porter', 'miller'] },
      { weekdays: [7] }, { intervalCount: 0 },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload: { ...payload, ...change } });
      expect(response.statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/parent/schedules' })).json().schedules).toEqual([]);
  });

  it('edits a schedule and its assignees without deleting generated completion history', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const id = created.json().id as string;
    const choreId = created.json().choreId as string;
    db.prepare(`INSERT INTO chore_occurrences (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
      VALUES ('historical', 'historical', ?, ?, '2026-10-12', '2026-10-12', 'individual')`).run(choreId, id);
    db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('historical', 'porter')").run();
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, updated_at)
      VALUES ('historical', '', 1, '2026-10-12T12:00:00Z')`).run();
    const changed = await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + id,
      payload: { ...payload, name: 'Sort recycling', assignees: ['miller'], frequency: 'daily', weekdays: [] } });
    expect(changed.statusCode).toBe(200);
    const schedules = (await app.inject({ method: 'GET', url: '/api/parent/schedules' })).json().schedules;
    expect(schedules[0]).toMatchObject({ name: 'Sort recycling', assignees: ['miller'], frequency: 'daily' });
    expect(db.prepare("SELECT completed FROM chore_completions WHERE occurrence_id = 'historical'").get()).toMatchObject({ completed: 1 });
    expect(db.prepare("SELECT child_id FROM occurrence_assignees WHERE occurrence_id = 'historical'").get()).toMatchObject({ child_id: 'porter' });
  });
  it('rejects invalid edits and unknown schedule ids', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/parent/schedules/missing', payload })).statusCode).toBe(404);
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    expect((await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + created.json().id,
      payload: { ...payload, assignees: ['unknown'] } })).statusCode).toBe(400);
  });

  it('hides generated chores on pause and restores them on resume', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules',
      payload: { ...payload, frequency: 'daily', weekdays: [] } });
    const { id, choreId } = created.json() as { id: string; choreId: string };
    db.prepare(`INSERT INTO chore_occurrences (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
      VALUES ('pause-occ', 'pause-occ', ?, ?, '2026-10-12', '2026-10-12', 'individual')`).run(choreId, id);
    db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('pause-occ', 'porter')").run();
    const board = async () => (await app.inject({ method: 'GET', url: '/api/chores?date=2026-10-14' })).json();
    expect(JSON.stringify(await board())).toContain('pause-occ');
    await app.inject({ method: 'PATCH', url: '/api/parent/schedules/' + id, payload: { paused: true } });
    expect(JSON.stringify(await board())).not.toContain('pause-occ');
    await app.inject({ method: 'PATCH', url: '/api/parent/schedules/' + id, payload: { paused: false } });
    expect(JSON.stringify(await board())).toContain('pause-occ');
  });
  it('reconciles untouched future occurrences while preserving completion history', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const { id, choreId } = created.json() as { id: string; choreId: string };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const next = (days: number) => new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    for (const [occurrence, day] of [['past', '2026-01-01'], ['future', next(1)], ['completed-future', next(2)]] as const) {
      db.prepare(`INSERT INTO chore_occurrences (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
        VALUES (?, ?, ?, ?, ?, ?, 'individual')`).run(occurrence, occurrence, choreId, id, day, day);
      db.prepare('INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES (?, ?)').run(occurrence, 'porter');
    }
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, updated_at)
      VALUES ('completed-future', '', 1, '2026-10-14T12:00:00Z')`).run();
    const response = await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + id,
      payload: { ...payload, assignees: ['miller'] } });
    expect(response.statusCode).toBe(200);
    const remaining = db.prepare('SELECT id FROM chore_occurrences ORDER BY id').all() as { id: string }[];
    expect(remaining.map(row => row.id)).toEqual(['completed-future', 'past']);
    expect(db.prepare("SELECT completed FROM chore_completions WHERE occurrence_id = 'completed-future'").get()).toMatchObject({ completed: 1 });
  });

  it('previews generated weekly occurrences and rejects invalid ranges', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const url = '/api/parent/schedules/' + created.json().id + '/preview';
    const preview = await app.inject({ method: 'GET', url: url + '?from=2026-10-12&to=2026-11-12' });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().occurrences.length).toBeGreaterThan(0);
    for (const query of ['?from=2026-02-30&to=2026-03-01', '?from=2026-11-01&to=2026-10-01',
      '?from=2026-01-01&to=2027-12-01']) {
      expect((await app.inject({ method: 'GET', url: url + query })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/parent/schedules/missing/preview' })).statusCode).toBe(404);
  });
  it('creates, replaces, lists and removes future exceptions', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const url = '/api/parent/schedules/' + created.json().id + '/exceptions';
    const date = '2026-12-07';
    expect((await app.inject({ method: 'PUT', url: url + '/' + date, payload: { action: 'skip' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url })).json().exceptions).toEqual([
      expect.objectContaining({ originalDate: date, action: 'skip' }),
    ]);
    expect((await app.inject({ method: 'PUT', url: url + '/' + date,
      payload: { action: 'move', newDate: '2026-12-08' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url })).json().exceptions[0]).toMatchObject({
      action: 'move', newDate: '2026-12-08',
    });
    expect((await app.inject({ method: 'PUT', url: url + '/' + date,
      payload: { action: 'reassign', childId: 'miller' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url })).json().exceptions[0]).toMatchObject({
      action: 'reassign', childId: 'miller',
    });
    expect((await app.inject({ method: 'DELETE', url: url + '/' + date })).json()).toEqual({ removed: true });
    expect((await app.inject({ method: 'GET', url })).json().exceptions).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: url + '/' + date })).json()).toEqual({ removed: false });
  });
  it('rejects malformed, past and unknown-schedule exceptions', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const url = '/api/parent/schedules/' + created.json().id + '/exceptions';
    for (const input of [{ action: 'unknown' }, { action: 'move' },
      { action: 'move', newDate: '2026-01-01' }, { action: 'reassign', childId: 'unknown' },
      { action: 'skip', childId: 'porter' }, { action: 'move', newDate: '2026-12-08', childId: 'porter' },
      { action: 'reassign', childId: 'porter', newDate: '2026-12-08' }]) {
      expect((await app.inject({ method: 'PUT', url: url + '/2026-12-07', payload: input })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'PUT', url: url + '/2026-01-01',
      payload: { action: 'skip' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/parent/schedules/missing/exceptions/2026-12-07',
      payload: { action: 'skip' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/parent/schedules/missing/exceptions' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/parent/schedules/missing/exceptions/2026-12-07' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: url + '/2026-01-01' })).statusCode).toBe(400);
  });
  it('protects completion history against exception changes and removal', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const { id, choreId } = created.json() as { id: string; choreId: string };
    db.prepare(`INSERT INTO chore_occurrences (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
      VALUES ('protected', ?, ?, ?, '2026-12-07', '2026-12-07', 'individual')`)
      .run(id + ':2026-12-07', choreId, id);
    db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('protected', 'porter')").run();
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, updated_at)
      VALUES ('protected', '', 1, '2026-10-14T12:00:00Z')`).run();
    const url = '/api/parent/schedules/' + id + '/exceptions/2026-12-07';
    expect((await app.inject({ method: 'PUT', url, payload: { action: 'skip' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(409);
    expect(db.prepare("SELECT completed FROM chore_completions WHERE occurrence_id = 'protected'").get()).toMatchObject({ completed: 1 });
  });
  it('rejects invalid pause payload and unknown schedules', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/schedules/unknown', payload: { paused: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/schedules/unknown', payload: { paused: 'yes' } })).statusCode).toBe(400);
  });
});
