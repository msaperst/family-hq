import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import { addChild } from '../../src/server/chores.js';

describe('parent endpoint LCOV validation branches', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof buildApp>;
  const base = { name: 'Laundry', mode: 'individual', frequency: 'weekly', intervalCount: 1,
    weekdays: [0], anchorDate: '2026-10-12', endDate: null, rotation: 'none', assignees: ['alex'] };
  beforeEach(() => {
    db = openDatabase(':memory:');
    addChild(db, 'alex', 'Alex');
    addChild(db, 'sam', 'Sam');
    app = buildApp({ db });
  });
  afterEach(async () => { await app.close(); db.close(); });
  it.each([
    ['missing name', { name: undefined }],
    ['numeric name', { name: 12 }],
    ['whitespace name', { name: '  ' }],
    ['overlong name', { name: 'x'.repeat(121) }],
    ['missing mode', { mode: undefined }],
    ['missing frequency', { frequency: undefined }],
    ['missing interval', { intervalCount: undefined }],
    ['fractional interval', { intervalCount: 1.5 }],
    ['negative interval', { intervalCount: -1 }],
    ['interval over maximum', { intervalCount: 366 }],
    ['missing weekdays', { weekdays: undefined }],
    ['noninteger weekday', { weekdays: [0.5] }],
    ['negative weekday', { weekdays: [-1] }],
    ['weekday above Sunday', { weekdays: [7] }],
    ['duplicate weekday', { weekdays: [0, 0] }],
    ['missing start', { anchorDate: undefined }],
    ['non-string start', { anchorDate: 1 }],
    ['invalid calendar start', { anchorDate: '2026-02-30' }],
    ['invalid end', { endDate: '2026-02-30' }],
    ['end before start', { endDate: '2026-10-11' }],
    ['missing rotation', { rotation: undefined }],
    ['missing assignees', { assignees: undefined }],
    ['empty assignees', { assignees: [] }],
    ['nonstring assignee', { assignees: [123] }],
    ['empty assignee id', { assignees: [''] }],
    ['duplicate assignees', { assignees: ['alex', 'alex'] }],
    ['multiple children without rotation', { assignees: ['alex', 'sam'] }],
    ['rotation in shared mode', { mode: 'either', rotation: 'daily' }],
    ['flexible weekly with interval', { weekdays: [], intervalCount: 2 }],
  ])('rejects %s without persisting a schedule', async (_description, change) => {
    const result = await app.inject({ method: 'POST', url: '/api/parent/schedules',
      payload: { ...base, ...change } });
    expect(result.statusCode).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS count FROM chore_schedules').get()).toMatchObject({ count: 0 });
  });
  it.each([
    ['maximum interval', { intervalCount: 365 }],
    ['maximum name length', { name: 'x'.repeat(120) }],
    ['flexible weekly deadline', { weekdays: [] }],
    ['rotating individual assignment', { rotation: 'daily', assignees: ['alex', 'sam'] }],
    ['each child completes', { mode: 'each', assignees: ['alex', 'sam'] }],
    ['either child completes', { mode: 'either', assignees: ['alex', 'sam'] }],
    ['optional end date', { endDate: '2026-11-01' }],
  ])('accepts %s', async (_description, change) => {
    const result = await app.inject({ method: 'POST', url: '/api/parent/schedules',
      payload: { ...base, ...change } });
    expect(result.statusCode).toBe(201);
    expect(db.prepare('SELECT COUNT(*) AS count FROM chore_schedules').get()).toMatchObject({ count: 1 });
  });
  it('rejects invalid edit payload before schedule lookup', async () => {
    const result = await app.inject({ method: 'PUT', url: '/api/parent/schedules/nonexistent',
      payload: { ...base, weekdays: [8] } });
    expect(result.statusCode).toBe(400);
  });
  it('validates preview range with omitted and explicit endpoints', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/parent/schedules', payload: base });
    const url = '/api/parent/schedules/' + created.json().id + '/preview';
    for (const query of ['', '?from=2026-10-12', '?from=2026-10-12&to=2026-10-12',
      '?from=2026-10-12&to=2027-10-13']) {
      expect((await app.inject({ method: 'GET', url: url + query })).statusCode, query).toBe(200);
    }
    for (const query of ['?from=2026-02-30', '?from=2026-10-12&to=2026-02-30',
      '?from=2026-10-12&to=2026-10-11', '?from=2026-10-12&to=2027-10-14']) {
      expect((await app.inject({ method: 'GET', url: url + query })).statusCode, query).toBe(400);
    }
  });
});
