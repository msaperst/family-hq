import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import type { DatabaseSync } from 'node:sqlite';

describe('first-run children management', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { db = openDatabase(':memory:'); app = buildApp({ db }); });
  afterEach(async () => { await app.close(); db.close(); });

  it('creates children in a fresh database and exposes them to chore assignment', async () => {
    expect((await app.inject('/api/children')).json().children).toEqual([]);
    const created = await app.inject({ method: 'POST', url: '/api/parent/children', payload: { name: '  Alex  ' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().name).toBe('Alex');
    const id = created.json().id as string;
    expect((await app.inject('/api/children')).json().children).toEqual([{ id, name: 'Alex' }]);
    expect((await app.inject('/api/parent/children')).json().children).toEqual([{ id, name: 'Alex', active: 1 }]);
    const schedule = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload: {
      name: 'Tidy toys', mode: 'individual', frequency: 'daily', intervalCount: 1,
      weekdays: [], anchorDate: '2026-10-16', endDate: null, rotation: 'none', assignees: [id],
    } });
    expect(schedule.statusCode).toBe(201);
  });

  it('renames a child without changing identity or schedule assignments', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/children', payload: { name: 'Alex' } });
    const id = created.json().id as string;
    const renamed = await app.inject({ method: 'PATCH', url: '/api/parent/children/' + id, payload: { name: 'Taylor' } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toEqual({ id, name: 'Taylor', active: true });
    expect((await app.inject('/api/children')).json().children).toEqual([{ id, name: 'Taylor' }]);
  });

  it('validates duplicate and missing names and prevents accidental removal of assigned children', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/parent/children', payload: { name: 'Alex' } });
    const id = first.json().id as string;
    expect((await app.inject({ method: 'POST', url: '/api/parent/children', payload: { name: ' alex ' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/parent/children', payload: { name: ' ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/children/' + id, payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/children/' + id, payload: { active: false } })).statusCode).toBe(200);
    expect((await app.inject('/api/children')).json().children).toEqual([]);
    expect((await app.inject({ method: 'PATCH', url: '/api/parent/children/' + id, payload: { active: true } })).statusCode).toBe(200);
    db.prepare('INSERT INTO chores (id, name) VALUES (?, ?)').run('task', 'Test');
    db.prepare("INSERT INTO chore_schedules (id, chore_id, mode, frequency, anchor_date) VALUES (?, ?, 'individual', 'daily', '2026-10-16')").run('schedule', 'task');
    db.prepare('INSERT INTO schedule_assignees (schedule_id, child_id) VALUES (?, ?)').run('schedule', id);
    const deactivated = await app.inject({ method: 'PATCH', url: '/api/parent/children/' + id, payload: { active: false } });
    expect(deactivated.statusCode).toBe(409);
    expect((await app.inject('/api/children')).json().children).toHaveLength(1);
  });
  it('deactivates an assigned child after schedules are paused without losing history', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/children', payload: { name: 'Alex' } });
    const id = created.json().id as string;
    const scheduled = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload: {
      name: 'Tidy toys', mode: 'individual', frequency: 'daily', intervalCount: 1,
      weekdays: [], anchorDate: '2026-10-16', endDate: null, rotation: 'none', assignees: [id],
    } });
    expect(scheduled.statusCode).toBe(201);
    const url = '/api/parent/children/' + id;
    expect((await app.inject({ method: 'PATCH', url, payload: { active: false } })).statusCode).toBe(409);
    expect((await app.inject({
      method: 'PATCH', url: '/api/parent/schedules/' + scheduled.json().id, payload: { paused: true },
    })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url, payload: { active: false } })).statusCode).toBe(200);
    expect((await app.inject('/api/children')).json().children).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url, payload: { active: true } })).statusCode).toBe(200);
    expect((await app.inject('/api/parent/schedules')).json().schedules[0].assignees).toEqual([id]);
  });

  it('allows permanent deletion only for a child never assigned or referenced', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/children', payload: { name: 'Temporary' } });
    const url = '/api/parent/children/' + created.json().id;
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(204);
    expect((await app.inject('/api/parent/children')).json().children).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(404);
  });

});
