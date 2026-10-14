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
  it('rejects invalid pause payload and unknown schedules', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/schedules/unknown', payload: { paused: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/schedules/unknown', payload: { paused: 'yes' } })).statusCode).toBe(400);
  });
});
