import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import { addChild } from '../../src/server/chores.js';
import { localToday } from '../../src/server/dashboard.js';

describe('parent schedule API', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    db = openDatabase(':memory:');
    addChild(db, 'alex', 'Alex');
    addChild(db, 'sam', 'Sam');
    app = buildApp({ db });
  });
  afterEach(async () => { await app.close(); db.close(); });
  const payload = {
    name: 'Take out recycling', mode: 'individual', frequency: 'weekly',
    intervalCount: 1, weekdays: [0], anchorDate: '2026-10-12',
    endDate: null, rotation: 'none', assignees: ['alex'],
  };
  it('creates and lists a recurring schedule with its assignees', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({ method: 'GET', url: '/api/parent/schedules' });
    expect(listed.json().schedules).toEqual([expect.objectContaining({
      id: created.json().id, name: payload.name, assignees: ['alex'], weekdays: [0], paused: false,
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
      { anchorDate: '2026-02-30' }, { assignees: ['alex', 'alex'] },
      { assignees: ['missing'] }, { assignees: ['alex', 'sam'] },
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
    db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('historical', 'alex')").run();
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, updated_at)
      VALUES ('historical', '', 1, '2026-10-12T12:00:00Z')`).run();
    const changed = await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + id,
      payload: { ...payload, name: 'Sort recycling', assignees: ['sam'], frequency: 'daily', weekdays: [] } });
    expect(changed.statusCode).toBe(200);
    const schedules = (await app.inject({ method: 'GET', url: '/api/parent/schedules' })).json().schedules;
    expect(schedules[0]).toMatchObject({ name: 'Sort recycling', assignees: ['sam'], frequency: 'daily' });
    expect(db.prepare("SELECT completed FROM chore_completions WHERE occurrence_id = 'historical'").get()).toMatchObject({ completed: 1 });
    expect(db.prepare("SELECT child_id FROM occurrence_assignees WHERE occurrence_id = 'historical'").get()).toMatchObject({ child_id: 'alex' });
  });

  it('regenerates an untouched occurrence due today when individual changes to each child', async () => {
    const today = localToday();
    const input = { ...payload, name: 'Make bed', mode: 'individual', frequency: 'daily',
      weekdays: [], anchorDate: today, assignees: ['alex'] };
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload: input });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };
    expect((await app.inject({ method: 'GET', url: '/api/chores?more=false' })).statusCode).toBe(200);
    const key = id + ':' + today;
    expect(db.prepare('SELECT mode FROM chore_occurrences WHERE occurrence_key = ?').get(key)).toMatchObject({ mode: 'individual' });
    const edited = await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + id,
      payload: { ...input, mode: 'each', assignees: ['alex', 'sam'] } });
    expect(edited.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/chores?more=false' })).statusCode).toBe(200);
    expect(db.prepare('SELECT mode FROM chore_occurrences WHERE occurrence_key = ?').get(key)).toMatchObject({ mode: 'each' });
    expect(db.prepare('SELECT child_id FROM occurrence_assignees WHERE occurrence_id = ? ORDER BY child_id')
      .all(key)).toEqual([{ child_id: 'sam' }, { child_id: 'alex' }]);
  });

  it('preserves completed occurrence history after a completion-mode edit', async () => {
    const today = localToday();
    const input = { ...payload, name: 'Make bed', mode: 'individual', frequency: 'daily',
      weekdays: [], anchorDate: today, assignees: ['alex'] };
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload: input });
    const { id } = created.json() as { id: string };
    expect((await app.inject({ method: 'GET', url: '/api/chores?more=false' })).statusCode).toBe(200);
    const key = id + ':' + today;
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, updated_at)
      VALUES (?, '', 1, '2026-10-15T12:00:00Z')`).run(key);
    expect((await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + id,
      payload: { ...input, mode: 'each', assignees: ['alex', 'sam'] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/chores?more=false' })).statusCode).toBe(200);
    expect(db.prepare('SELECT mode FROM chore_occurrences WHERE occurrence_key = ?').get(key)).toMatchObject({ mode: 'individual' });
    expect(db.prepare('SELECT completed FROM chore_completions WHERE occurrence_id = ? AND child_id = ?')
      .get(key, '')).toMatchObject({ completed: 1 });
    expect(db.prepare('SELECT child_id FROM occurrence_assignees WHERE occurrence_id = ?').all(key))
      .toEqual([{ child_id: 'alex' }]);
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
    db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('pause-occ', 'alex')").run();
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
      db.prepare('INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES (?, ?)').run(occurrence, 'alex');
    }
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, updated_at)
      VALUES ('completed-future', '', 1, '2026-10-14T12:00:00Z')`).run();
    const response = await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + id,
      payload: { ...payload, assignees: ['sam'] } });
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
      payload: { action: 'reassign', childId: 'sam' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url })).json().exceptions[0]).toMatchObject({
      action: 'reassign', childId: 'sam',
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
      { action: 'skip', childId: 'alex' }, { action: 'move', newDate: '2026-12-08', childId: 'alex' },
      { action: 'reassign', childId: 'alex', newDate: '2026-12-08' }]) {
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
    db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('protected', 'alex')").run();
    db.prepare(`INSERT INTO chore_completions (occurrence_id, child_id, completed, updated_at)
      VALUES ('protected', '', 1, '2026-10-14T12:00:00Z')`).run();
    const url = '/api/parent/schedules/' + id + '/exceptions/2026-12-07';
    expect((await app.inject({ method: 'PUT', url, payload: { action: 'skip' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(409);
    expect(db.prepare("SELECT completed FROM chore_completions WHERE occurrence_id = 'protected'").get()).toMatchObject({ completed: 1 });
  });

  it('rolls back schedule creation when an assignee insert fails', async () => {
    db.exec(`CREATE TRIGGER reject_create_assignment BEFORE INSERT ON schedule_assignees
      BEGIN SELECT RAISE(ABORT, 'simulated assignment failure'); END`);
    const result = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    expect(result.statusCode).toBe(500);
    expect(db.prepare('SELECT COUNT(*) AS n FROM chores').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM chore_schedules').get()).toMatchObject({ n: 0 });
  });
  it('rolls back schedule edits, preserving name, assignments and generated occurrences', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const { id, choreId } = created.json() as { id: string; choreId: string };
    db.prepare(`INSERT INTO chore_occurrences (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
      VALUES ('rollback-future', 'rollback-future', ?, ?, '2099-01-01', '2099-01-01', 'individual')`).run(choreId, id);
    db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('rollback-future', 'alex')").run();
    db.exec(`CREATE TRIGGER reject_edit_assignment BEFORE INSERT ON schedule_assignees
      BEGIN SELECT RAISE(ABORT, 'simulated edit failure'); END`);
    const result = await app.inject({ method: 'PUT', url: '/api/parent/schedules/' + id,
      payload: { ...payload, name: 'Changed name', assignees: ['sam'] } });
    expect(result.statusCode).toBe(500);
    expect(db.prepare('SELECT name FROM chores WHERE id = ?').get(choreId)).toMatchObject({ name: payload.name });
    expect(db.prepare('SELECT child_id FROM schedule_assignees WHERE schedule_id = ?').get(id)).toMatchObject({ child_id: 'alex' });
    expect(db.prepare("SELECT id FROM chore_occurrences WHERE id = 'rollback-future'").get()).toBeDefined();
  });
  it('rolls back failed exception upserts and preserves the original override', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const url = '/api/parent/schedules/' + created.json().id + '/exceptions/2099-01-05';
    expect((await app.inject({ method: 'PUT', url, payload: { action: 'skip' } })).statusCode).toBe(200);
    db.exec(`CREATE TRIGGER reject_exception_update BEFORE UPDATE ON occurrence_overrides
      BEGIN SELECT RAISE(ABORT, 'simulated override failure'); END`);
    expect((await app.inject({ method: 'PUT', url, payload: { action: 'reassign', childId: 'sam' } })).statusCode).toBe(500);
    const list = await app.inject({ method: 'GET', url: '/api/parent/schedules/' + created.json().id + '/exceptions' });
    expect(list.json().exceptions).toEqual([expect.objectContaining({ action: 'skip', originalDate: '2099-01-05' })]);
  });
  it('rolls back failed exception deletion and retains the override', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const url = '/api/parent/schedules/' + created.json().id + '/exceptions/2099-01-05';
    expect((await app.inject({ method: 'PUT', url, payload: { action: 'skip' } })).statusCode).toBe(200);
    db.exec(`CREATE TRIGGER reject_exception_delete BEFORE DELETE ON occurrence_overrides
      BEGIN SELECT RAISE(ABORT, 'simulated deletion failure'); END`);
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(500);
    const list = await app.inject({ method: 'GET', url: '/api/parent/schedules/' + created.json().id + '/exceptions' });
    expect(list.json().exceptions).toEqual([expect.objectContaining({ action: 'skip', originalDate: '2099-01-05' })]);
  });

  it('validates schedule input boundary combinations', async () => {
    const invalid = [
      null, {}, { ...payload, name: '' }, { ...payload, name: 'x'.repeat(121) },
      { ...payload, mode: 'unknown' }, { ...payload, frequency: 'hourly' },
      { ...payload, intervalCount: 1.5 }, { ...payload, intervalCount: 366 },
      { ...payload, weekdays: [0, 0] }, { ...payload, weekdays: [-1] },
      { ...payload, anchorDate: 'not-a-date' }, { ...payload, endDate: '2026-10-01' },
      { ...payload, endDate: '2026-02-30' }, { ...payload, rotation: 'invalid' },
      { ...payload, assignees: [] }, { ...payload, assignees: [''] },
      { ...payload, assignees: [123] }, { ...payload, assignees: ['alex', 'alex'] },
      { ...payload, mode: 'either', rotation: 'weekly' },
      { ...payload, weekdays: [], intervalCount: 2 },
    ];
    for (const input of invalid) {
      const result = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload: input });
      expect(result.statusCode, JSON.stringify(input)).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM chore_schedules').get()).toMatchObject({ n: 0 });
  });
  it('validates exception date, action and completion event conflicts', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const { id, choreId } = created.json() as { id: string; choreId: string };
    const base = '/api/parent/schedules/' + id + '/exceptions/';
    for (const [date, input] of [
      ['2026-02-30', { action: 'skip' }],
      ['2099-01-05', { action: 'move', newDate: '2026-02-30' }],
      ['2099-01-05', { action: 'reassign' }],
      ['2099-01-05', { action: 'skip', newDate: '2099-01-06' }],
    ] as const) {
      expect((await app.inject({ method: 'PUT', url: base + date, payload: input })).statusCode).toBe(400);
    }
    db.prepare(`INSERT INTO chore_occurrences (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
      VALUES ('audited', ?, ?, ?, '2099-01-05', '2099-01-05', 'individual')`)
      .run(id + ':2099-01-05', choreId, id);
    db.prepare(`INSERT INTO completion_events (occurrence_id, child_id, completed, occurred_at)
      VALUES ('audited', '', 0, '2026-10-14T12:00:00Z')`).run();
    expect((await app.inject({ method: 'PUT', url: base + '2099-01-05', payload: { action: 'skip' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: base + '2099-01-05' })).statusCode).toBe(409);
    expect(db.prepare("SELECT id FROM chore_occurrences WHERE id = 'audited'").get()).toBeDefined();
  });

  it('rejects invalid preview from dates even when to is omitted', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    for (const from of ['garbage', '2026-02-30', '2026-13-01', '']) {
      const result = await app.inject({ method: 'GET',
        url: '/api/parent/schedules/' + created.json().id + '/preview?from=' + encodeURIComponent(from) });
      expect(result.statusCode, from).toBe(400);
      expect(result.json()).toEqual({ error: 'Invalid preview date range' });
    }
  });
  it('replaces and removes an existing persisted future occurrence when overriding it', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload });
    const { id, choreId } = created.json() as { id: string; choreId: string };
    const date = '2099-01-05';
    const insert = () => {
      db.prepare(`INSERT INTO chore_occurrences (id, occurrence_key, chore_id, schedule_id, starts_on, due_on, mode)
        VALUES ('replaceable', ?, ?, ?, ?, ?, 'individual')`).run(id + ':' + date, choreId, id, date, date);
      db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('replaceable', 'alex')").run();
    };
    insert();
    const url = '/api/parent/schedules/' + id + '/exceptions/' + date;
    expect((await app.inject({ method: 'PUT', url, payload: { action: 'skip' } })).statusCode).toBe(200);
    expect(db.prepare("SELECT id FROM chore_occurrences WHERE id = 'replaceable'").get()).toBeUndefined();
    insert();
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(200);
    expect(db.prepare("SELECT id FROM chore_occurrences WHERE id = 'replaceable'").get()).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/parent/schedules/' + id + '/exceptions' })).json().exceptions).toEqual([]);
  });
  it('rejects invalid pause payload and unknown schedules', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/schedules/unknown', payload: { paused: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/schedules/unknown', payload: { paused: 'yes' } })).statusCode).toBe(400);
  });
});
