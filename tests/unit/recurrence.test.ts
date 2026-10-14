import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db';
import { addChild, addChore, getCompletion, setCompletion } from '../../src/server/chores';
import { generateOccurrences, previewOccurrences } from '../../src/server/recurrence';

function fixture(options: {frequency?: string; weekdays?: number[]; rotation?: string; mode?: string; anchor?: string; interval?: number; end?: string; children?: string[]} = {}) {
  const db = openDatabase(':memory:');
  addChild(db, 'porter', 'Porter'); addChild(db, 'miller', 'Miller'); addChore(db, 'chore', 'Chore');
  db.prepare('INSERT INTO chore_schedules (id,chore_id,mode,frequency,interval_count,weekdays,anchor_date,end_date,rotation) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('schedule','chore',options.mode ?? 'individual',options.frequency ?? 'daily',options.interval ?? 1,JSON.stringify(options.weekdays ?? []),options.anchor ?? '2026-10-12',options.end ?? null,options.rotation ?? 'none');
  for (const [index,child] of (options.children ?? ['porter']).entries()) db.prepare('INSERT INTO schedule_assignees (schedule_id,child_id,rotation_order) VALUES (?,?,?)').run('schedule',child,index);
  return db;
}
describe('recurrence engine', () => {
  it('generates selected weekdays without weekends and reruns idempotently', () => {
    const db = fixture({weekdays:[0,2,4]});
    try {
      expect(generateOccurrences(db,'schedule','2026-10-12','2026-10-18').map(x=>x.startsOn)).toEqual(['2026-10-12','2026-10-14','2026-10-16']);
      generateOccurrences(db,'schedule','2026-10-12','2026-10-18');
      expect((db.prepare('SELECT count(*) AS n FROM chore_occurrences').get() as {n:number}).n).toBe(3);
    } finally { db.close(); }
  });
  it('creates one flexible weekly obligation with Monday–Sunday boundaries', () => {
    const db = fixture({frequency:'weekly'});
    try {
      expect(generateOccurrences(db,'schedule','2026-10-14','2026-10-20').map(x=>[x.startsOn,x.dueOn])).toEqual([['2026-10-12','2026-10-18'],['2026-10-19','2026-10-25']]);
    } finally { db.close(); }
  });
  it('alternates weekly across October and year boundaries', () => {
    const db = fixture({rotation:'weekly',children:['porter','miller'],anchor:'2026-12-28'});
    try {
      const x=previewOccurrences(db,'schedule','2026-12-28','2027-01-11');
      expect(x.filter(v=>v.startsOn==='2026-12-28')[0].assignees).toEqual(['porter']);
      expect(x.filter(v=>v.startsOn==='2027-01-04')[0].assignees).toEqual(['miller']);
      expect(x.filter(v=>v.startsOn==='2027-01-11')[0].assignees).toEqual(['porter']);
    } finally { db.close(); }
  });
  it('supports every N days across month boundaries', () => {
    const db=fixture({frequency:'interval_days',interval:3,anchor:'2026-10-30'});
    try { expect(previewOccurrences(db,'schedule','2026-10-30','2026-11-06').map(x=>x.startsOn)).toEqual(['2026-10-30','2026-11-02','2026-11-05']); }
    finally {db.close();}
  });
  it('supports every N weeks and explicit weekday selection', () => {
    const db=fixture({frequency:'interval_weeks',interval:2,weekdays:[0],anchor:'2026-10-12'});
    try { expect(previewOccurrences(db,'schedule','2026-10-12','2026-11-09').map(x=>x.startsOn)).toEqual(['2026-10-12','2026-10-26','2026-11-09']); }
    finally {db.close();}
  });
  it('handles each-child obligations independently and retains completion after regeneration', () => {
    const db=fixture({mode:'each',children:['porter','miller']});
    try {
      generateOccurrences(db,'schedule','2026-10-12','2026-10-12');
      setCompletion(db,'schedule:2026-10-12','porter',true);
      generateOccurrences(db,'schedule','2026-10-12','2026-10-12');
      expect(getCompletion(db,'schedule:2026-10-12','porter')).toBe(true);
      expect(getCompletion(db,'schedule:2026-10-12','miller')).toBe(false);
    } finally {db.close();}
  });
  it('skips a specific occurrence without changing its neighbors', () => {
    const db=fixture();
    try {
      db.prepare("INSERT INTO occurrence_overrides (id,schedule_id,original_date,action) VALUES ('skip','schedule','2026-10-13','skip')").run();
      generateOccurrences(db,'schedule','2026-10-12','2026-10-14');
      expect((db.prepare("SELECT status FROM chore_occurrences WHERE id = 'schedule:2026-10-13'").get() as {status:string}).status).toBe('skipped');
      expect(()=>setCompletion(db,'schedule:2026-10-13','porter',true)).toThrow();
      expect((db.prepare("SELECT status FROM chore_occurrences WHERE id = 'schedule:2026-10-14'").get() as {status:string}).status).toBe('active');
    } finally {db.close();}
  });
  it('rejects invalid dates, reversed ranges, and unknown schedules', () => {
    const db=fixture();
    try {
      expect(()=>previewOccurrences(db,'schedule','2026-02-30','2026-03-01')).toThrow('Invalid local date');
      expect(()=>previewOccurrences(db,'schedule','2026-10-20','2026-10-10')).toThrow('Date range');
      expect(()=>previewOccurrences(db,'missing','2026-10-12','2026-10-13')).toThrow('Schedule not found');
    } finally {db.close();}
  });
});
