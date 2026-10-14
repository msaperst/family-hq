import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db';
import { addChild, addChore, setCompletion, getCompletion } from '../../src/server/chores';
import { generateOccurrences, previewOccurrences } from '../../src/server/recurrence';

function fixture(options: { mode?: 'individual'|'either'|'each'; rotation?: 'none'|'daily'|'weekly'; frequency?: 'daily'|'weekly'; anchor?: string; children?: string[] } = {}) {
  const db = openDatabase(':memory:');
  addChild(db,'porter','Porter'); addChild(db,'miller','Miller'); addChore(db,'task','Task');
  db.prepare('INSERT INTO chore_schedules (id,chore_id,mode,frequency,anchor_date,rotation) VALUES (?,?,?,?,?,?)')
    .run('s','task',options.mode ?? 'individual',options.frequency ?? 'daily',options.anchor ?? '2026-10-12',options.rotation ?? 'none');
  for (const [index,child] of (options.children ?? ['porter']).entries())
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
    const db=fixture({rotation:'daily',children:['porter','miller']});
    try {
      override(db,'2026-10-13','reassign',null,'porter');
      const result=previewOccurrences(db,'s','2026-10-12','2026-10-15');
      expect(result.map(x=>x.assignees)).toEqual([['porter'],['porter'],['porter'],['miller']]);
    } finally {db.close();}
  });
  it('does not mutate shared schedule assignees when overriding one day', () => {
    const db=fixture({mode:'either',children:['porter','miller']});
    try {
      override(db,'2026-10-13','reassign',null,'porter');
      const result=previewOccurrences(db,'s','2026-10-12','2026-10-14');
      expect(result.map(x=>x.assignees)).toEqual([['porter','miller'],['porter'],['porter','miller']]);
    } finally {db.close();}
  });
  it('preserves completion when a later schedule change conflicts with an existing occurrence', () => {
    const db=fixture();
    try {
      generateOccurrences(db,'s','2026-10-12','2026-10-13');
      setCompletion(db,'s:2026-10-12','porter',true);
      db.prepare("UPDATE chore_schedules SET mode='each' WHERE id='s'").run();
      expect(()=>generateOccurrences(db,'s','2026-10-12','2026-10-13')).toThrow('key conflict');
      expect(getCompletion(db,'s:2026-10-12')).toBe(true);
      expect((db.prepare('SELECT count(*) AS n FROM completion_events').get() as {n:number}).n).toBe(1);
    } finally {db.close();}
  });
  it('rotates by calendar day across a month boundary', () => {
    const db=fixture({rotation:'daily',children:['porter','miller'],anchor:'2026-10-30'});
    try {
      expect(previewOccurrences(db,'s','2026-10-30','2026-11-02').map(x=>x.assignees[0])).toEqual(['porter','miller','porter','miller']);
    } finally {db.close();}
  });
  it('returns no occurrences for paused schedules', () => {
    const db=fixture();
    try {
      db.prepare("UPDATE chore_schedules SET paused=1 WHERE id='s'").run();
      expect(generateOccurrences(db,'s','2026-10-12','2026-10-15')).toEqual([]);
    } finally {db.close();}
  });
});
