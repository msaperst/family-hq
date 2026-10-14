import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import { addChild, addChore } from '../../src/server/chores.js';
import type { DashboardResponse } from '../../src/shared/dashboard.js';

describe('seeded household workflow (disposable SQLite)', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    db = openDatabase(':memory:');
    app = buildApp({ db });
    addChild(db, 'porter', 'Porter');
    addChild(db, 'miller', 'Miller');
    addChore(db, 'bed', 'Make bed');
    addChore(db, 'pets', 'Feed pets');
    db.prepare(`INSERT INTO chore_schedules (id, chore_id, mode, frequency, anchor_date)
      VALUES ('bed-schedule', 'bed', 'individual', 'daily', '2026-10-13')`).run();
    db.prepare(`INSERT INTO chore_schedules (id, chore_id, mode, frequency, anchor_date)
      VALUES ('pet-schedule', 'pets', 'either', 'daily', '2026-10-13')`).run();
    db.prepare("INSERT INTO schedule_assignees (schedule_id, child_id, rotation_order) VALUES ('bed-schedule', 'porter', 0)").run();
    db.prepare("INSERT INTO schedule_assignees (schedule_id, child_id, rotation_order) VALUES ('pet-schedule', 'porter', 0)").run();
    db.prepare("INSERT INTO schedule_assignees (schedule_id, child_id, rotation_order) VALUES ('pet-schedule', 'miller', 1)").run();
  });
  afterEach(async () => { await app.close(); db.close(); });
  async function board(date: string): Promise<DashboardResponse> {
    const res = await app.inject({ method: 'GET', url: '/api/chores?date=' + date });
    expect(res.statusCode).toBe(200);
    return res.json() as DashboardResponse;
  }
  it('generates, completes, reloads and unchecks real occurrences', async () => {
    const initial = await board('2026-10-13');
    const bed = initial.columns.find(x => x.id === 'porter')!.chores.find(x => x.name === 'Make bed')!;
    const update = (completed: boolean) => app.inject({ method: 'PUT', url: '/api/chores/' + encodeURIComponent(bed.id) + '/completion', payload: { childId: 'porter', completed } });
    expect((await update(true)).json().changed).toBe(true);
    expect((await update(true)).json().changed).toBe(false);
    expect((await board('2026-10-13')).columns.find(x => x.id === 'porter')!.chores.find(x => x.id === bed.id)!.completed).toBe(true);
    expect((await board('2026-10-14')).columns.find(x => x.id === 'porter')!.chores.some(x => x.id === bed.id)).toBe(false);
    expect((await update(false)).json().changed).toBe(true);
    const overdue = await board('2026-10-14');
    expect(overdue.columns.find(x => x.id === 'porter')!.chores.find(x => x.id === bed.id)!.dueOn).toBe('2026-10-13');
    expect(db.prepare('SELECT COUNT(*) AS n FROM completion_events').get()).toMatchObject({ n: 2 });
  });
  it('completes shared chores once and hides shared column when nothing is due', async () => {
    const initial = await board('2026-10-13');
    const shared = initial.columns.find(x => x.id === 'either')!;
    expect(shared.chores.filter(x => x.dueOn === '2026-10-13')).toHaveLength(1);
    const id = shared.chores.find(x => x.dueOn === '2026-10-13')!.id;
    const res = await app.inject({ method: 'PUT', url: '/api/chores/' + encodeURIComponent(id) + '/completion', payload: { childId: null, completed: true } });
    expect(res.statusCode).toBe(200);
    const tomorrow = await board('2026-10-14');
    expect(tomorrow.columns.find(x => x.id === 'either')!.chores.every(x => x.id !== id)).toBe(true);
    db.prepare("UPDATE chore_schedules SET paused = 1 WHERE id = 'pet-schedule'").run();
    db.prepare("UPDATE chore_occurrences SET status = 'skipped' WHERE schedule_id = 'pet-schedule'").run();
    expect((await board('2026-10-14')).columns.some(x => x.id === 'either')).toBe(false);
  });
});

describe('overdue completion server contract', () => {
  it('persists completion immediately, omits it on refresh, and allows undo by occurrence id', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp({ db });
    try {
      addChild(db, 'porter', 'Porter');
      addChore(db, 'late', 'Late task');
      db.prepare("INSERT INTO chore_occurrences (id, occurrence_key, chore_id, starts_on, due_on, mode) VALUES ('late-occ', 'late-occ', 'late', '2026-10-12', '2026-10-12', 'individual')").run();
      db.prepare("INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES ('late-occ', 'porter')").run();
      const board = async () => (await app.inject({ method: 'GET', url: '/api/chores?date=2026-10-14' })).json() as DashboardResponse;
      expect((await board()).columns[0].chores.some(chore => chore.id === 'late-occ')).toBe(true);
      const toggle = (completed: boolean) => app.inject({ method: 'PUT', url: '/api/chores/late-occ/completion', payload: { childId: 'porter', completed } });
      expect((await toggle(true)).statusCode).toBe(200);
      expect((await board()).columns.every(column => column.chores.every(chore => chore.id !== 'late-occ'))).toBe(true);
      expect((await toggle(false)).statusCode).toBe(200);
      expect((await board()).columns[0].chores.find(chore => chore.id === 'late-occ')?.completed).toBe(false);
    } finally { await app.close(); db.close(); }
  });
});
