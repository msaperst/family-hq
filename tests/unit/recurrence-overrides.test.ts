import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db';
import { addChild, addChore, setCompletion, getCompletion } from '../../src/server/chores';
import { generateOccurrences, previewOccurrences } from '../../src/server/recurrence';

function fixture(options: { mode?: 'individual'|'either'|'each'; rotation?: 'none'|'daily'|'weekly'; frequency?: 'daily'|'weekly'; anchor?: string; children?: string[] } = {}) {
  const db = openDatabase(':memory:');
  addChild(db,'alex','Alex'); addChild(db,'sam','Sam'); addChore(db,'task','Task');
  db.prepare('INSERT INTO chore_schedules (id,chore_id,mode,frequency,anchor_date,rotation) VALUES (?,?,?,?,?,?)')
    .run('s','task',options.mode ?? 'individual',options.frequency ?? 'daily',options.anchor ?? '2026-10-12',options.rotation ?? 'none');
  for (const [index,child] of (options.children ?? ['alex']).entries())
    db.prepare('INSERT INTO schedule_assignees (schedule_id,child_id,rotation_order) VALUES (?,?,?)').run('s',child,index);
  return db;
}
function override(db: ReturnType<typeof openDatabase>, date: string, action: string, newDate: string | null = null, child: string | null = null) {
  db.prepare('INSERT INTO occurrence_overrides (id,schedule_id,original_date,action,new_date,child_id) VALUES (?,?,?,?,?,?)')
    .run(date,'s',date,action,newDate,child);
}
describe('recurrence overrides and history', () => {
  it('moves one occurrence while retaining its original identity', () => {
    const db=fixture();
    try {
      override(db,'2026-10-13','move','2026-10-16');
      const result=generateOccurrences(db,'s','2026-10-12','2026-10-16');
      expect(result.find(x=>x.key==='s:2026-10-13')).toMatchObject({startsOn:'2026-10-16',dueOn:'2026-10-16'});
      expect(result.find(x=>x.key==='s:2026-10-14')?.startsOn).toBe('2026-10-14');
      generateOccurrences(db,'s','2026-10-12','2026-10-16');
      expect((db.prepare('SELECT count(*) AS n FROM chore_occurrences').get() as {n:number}).n).toBe(5);
    } finally {db.close();}
  });
  it('reassigns a rotating occurrence without changing subsequent rotation', () => {
    const db=fixture({rotation:'daily',children:['alex','sam']});
    try {
      override(db,'2026-10-13','reassign',null,'alex');
      const result=previewOccurrences(db,'s','2026-10-12','2026-10-15');
      expect(result.map(x=>x.assignees)).toEqual([['alex'],['alex'],['alex'],['sam']]);
    } finally {db.close();}
  });
  it('does not mutate shared schedule assignees when overriding one day', () => {
    const db=fixture({mode:'either',children:['alex','sam']});
    try {
      override(db,'2026-10-13','reassign',null,'alex');
      const result=previewOccurrences(db,'s','2026-10-12','2026-10-14');
      expect(result.map(x=>x.assignees)).toEqual([['alex','sam'],['alex'],['alex','sam']]);
    } finally {db.close();}
  });
  it('preserves completion when a later schedule change conflicts with an existing occurrence', () => {
    const db=fixture();
    try {
      generateOccurrences(db,'s','2026-10-12','2026-10-13');
      setCompletion(db,'s:2026-10-12','alex',true);
      db.prepare("UPDATE chore_schedules SET mode='each' WHERE id='s'").run();
      expect(()=>generateOccurrences(db,'s','2026-10-12','2026-10-13')).toThrow('key conflict');
      expect(getCompletion(db,'s:2026-10-12')).toBe(true);
      expect((db.prepare('SELECT count(*) AS n FROM completion_events').get() as {n:number}).n).toBe(1);
    } finally {db.close();}
  });
  it('rotates by calendar day across a month boundary', () => {
    const db=fixture({rotation:'daily',children:['alex','sam'],anchor:'2026-10-30'});
    try {
      expect(previewOccurrences(db,'s','2026-10-30','2026-11-02').map(x=>x.assignees[0])).toEqual(['alex','sam','alex','sam']);
    } finally {db.close();}
  });
  it('returns no occurrences for paused schedules', () => {
    const db=fixture();
    try {
      db.prepare("UPDATE chore_schedules SET paused=1 WHERE id='s'").run();
      expect(generateOccurrences(db,'s','2026-10-12','2026-10-15')).toEqual([]);
    } finally {db.close();}
  });
  it('includes an occurrence moved into the query window from an earlier date', () => {
    const db=fixture();
    try {
      override(db,'2026-10-12','move','2026-10-20');
      const result=generateOccurrences(db,'s','2026-10-20','2026-10-20');
      expect(result.map(x=>x.key)).toEqual(['s:2026-10-12','s:2026-10-20']);
      expect(result[0]).toMatchObject({startsOn:'2026-10-20',dueOn:'2026-10-20'});
      generateOccurrences(db,'s','2026-10-20','2026-10-20');
      expect((db.prepare('SELECT count(*) AS n FROM chore_occurrences').get() as {n:number}).n).toBe(2);
    } finally {db.close();}
  });
  it('includes an occurrence moved from a later date into the query window', () => {
    const db=fixture();
    try {
      override(db,'2026-10-25','move','2026-10-14');
      const result=previewOccurrences(db,'s','2026-10-14','2026-10-14');
      expect(result.map(x=>x.key)).toEqual(['s:2026-10-14','s:2026-10-25']);
    } finally {db.close();}
  });
  it('does not include moved occurrences whose target lies outside the query window', () => {
    const db=fixture();
    try {
      override(db,'2026-10-12','move','2026-10-25');
      expect(previewOccurrences(db,'s','2026-10-20','2026-10-20').map(x=>x.key)).toEqual(['s:2026-10-20']);
    } finally {db.close();}
  });
  it('includes flexible weekly occurrences moved into a week from outside the range', () => {
    const db=fixture({frequency:'weekly'});
    try {
      override(db,'2026-10-12','move','2026-10-21');
      const result=previewOccurrences(db,'s','2026-10-23','2026-10-23');
      expect(result.map(x=>x.key)).toEqual(['s:2026-10-12','s:2026-10-19']);
      expect(result[0]).toMatchObject({startsOn:'2026-10-21',dueOn:'2026-10-27'});
    } finally {db.close();}
  });
});
