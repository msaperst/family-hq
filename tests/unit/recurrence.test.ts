import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db';
import { addChild, addChore, getCompletion, setCompletion } from '../../src/server/chores';
import { generateOccurrences, previewOccurrences } from '../../src/server/recurrence';

function fixture(options: {frequency?: string; weekdays?: number[]; rotation?: string; mode?: string; anchor?: string; interval?: number; end?: string; children?: string[]} = {}) {
  const db = openDatabase(':memory:');
  addChild(db, 'alex', 'Alex'); addChild(db, 'sam', 'Sam'); addChore(db, 'chore', 'Chore');
  db.prepare('INSERT INTO chore_schedules (id,chore_id,mode,frequency,interval_count,weekdays,anchor_date,end_date,rotation) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('schedule','chore',options.mode ?? 'individual',options.frequency ?? 'daily',options.interval ?? 1,JSON.stringify(options.weekdays ?? []),options.anchor ?? '2026-10-12',options.end ?? null,options.rotation ?? 'none');
  for (const [index,child] of (options.children ?? ['alex']).entries()) db.prepare('INSERT INTO schedule_assignees (schedule_id,child_id,rotation_order) VALUES (?,?,?)').run('schedule',child,index);
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
    const db = fixture({rotation:'weekly',children:['alex','sam'],anchor:'2026-12-28'});
    try {
      const x=previewOccurrences(db,'schedule','2026-12-28','2027-01-11');
      expect(x.filter(v=>v.startsOn==='2026-12-28')[0].assignees).toEqual(['alex']);
      expect(x.filter(v=>v.startsOn==='2027-01-04')[0].assignees).toEqual(['sam']);
      expect(x.filter(v=>v.startsOn==='2027-01-11')[0].assignees).toEqual(['alex']);
    } finally { db.close(); }
  });
  it('alternates by scheduled occurrence for non-daily weekdays, independent of preview window', () => {
    const db = fixture({ weekdays: [0, 2, 4], rotation: 'daily', children: ['alex', 'sam'] });
    try {
      const range = previewOccurrences(db, 'schedule', '2026-10-12', '2026-10-23');
      expect(range.map(x => [x.startsOn, x.assignees[0]])).toEqual([
        ['2026-10-12', 'alex'], ['2026-10-14', 'sam'], ['2026-10-16', 'alex'],
        ['2026-10-19', 'sam'], ['2026-10-21', 'alex'], ['2026-10-23', 'sam'],
      ]);
      expect(previewOccurrences(db, 'schedule', '2026-10-19', '2026-10-23').map(x => x.assignees[0]))
        .toEqual(['sam', 'alex', 'sam']);
    } finally { db.close(); }
  });
  it('alternates for every N days and retains skipped dates in rotation', () => {
    const db = fixture({ frequency: 'interval_days', interval: 2, anchor: '2026-10-12',
      rotation: 'daily', children: ['alex', 'sam'] });
    try {
      db.prepare("INSERT INTO occurrence_overrides (id,schedule_id,original_date,action) VALUES ('skip','schedule','2026-10-14','skip')").run();
      expect(previewOccurrences(db, 'schedule', '2026-10-12', '2026-10-20')
        .map(x => [x.startsOn, x.assignees[0], x.skipped])).toEqual([
          ['2026-10-12', 'alex', false], ['2026-10-14', 'sam', true],
          ['2026-10-16', 'alex', false], ['2026-10-18', 'sam', false],
          ['2026-10-20', 'alex', false],
        ]);
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
    const db=fixture({mode:'each',children:['alex','sam']});
    try {
      generateOccurrences(db,'schedule','2026-10-12','2026-10-12');
      setCompletion(db,'schedule:2026-10-12','alex',true);
      generateOccurrences(db,'schedule','2026-10-12','2026-10-12');
      expect(getCompletion(db,'schedule:2026-10-12','alex')).toBe(true);
      expect(getCompletion(db,'schedule:2026-10-12','sam')).toBe(false);
    } finally {db.close();}
  });
  it('skips a specific occurrence without changing its neighbors', () => {
    const db=fixture();
    try {
      db.prepare("INSERT INTO occurrence_overrides (id,schedule_id,original_date,action) VALUES ('skip','schedule','2026-10-13','skip')").run();
      generateOccurrences(db,'schedule','2026-10-12','2026-10-14');
      expect((db.prepare("SELECT status FROM chore_occurrences WHERE id = 'schedule:2026-10-13'").get() as {status:string}).status).toBe('skipped');
      expect(()=>setCompletion(db,'schedule:2026-10-13','alex',true)).toThrow();
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
  it('rejects invalid weekday JSON values and out-of-range weekday numbers', () => {
    const db = fixture();
    try {
      for (const value of ['"Monday"', '[7]', '[-1]', '[1.5]', '[null]', '{}']) {
        db.prepare('UPDATE chore_schedules SET weekdays = ? WHERE id = ?').run(value, 'schedule');
        expect(() => previewOccurrences(db, 'schedule', '2026-10-12', '2026-10-18')).toThrow('Weekdays must be');
      }
    } finally { db.close(); }
  });
  it('deduplicates repeated weekdays instead of generating duplicate obligations', () => {
    const db = fixture({weekdays:[0,0,2,2]});
    try {
      expect(generateOccurrences(db,'schedule','2026-10-12','2026-10-18').map(x=>x.startsOn)).toEqual(['2026-10-12','2026-10-14']);
      expect((db.prepare('SELECT count(*) AS n FROM chore_occurrences').get() as {n:number}).n).toBe(2);
    } finally { db.close(); }
  });
  it('rejects an individual schedule with multiple assignees and an empty schedule', () => {
    const db = fixture({children:['alex','sam']});
    try {
      expect(()=>previewOccurrences(db,'schedule','2026-10-12','2026-10-13')).toThrow('Invalid schedule assignees');
      db.prepare("DELETE FROM schedule_assignees WHERE schedule_id = 'schedule'").run();
      expect(()=>previewOccurrences(db,'schedule','2026-10-12','2026-10-13')).toThrow('Invalid schedule assignees');
    } finally { db.close(); }
  });
  it('honors schedule end dates and one-time recurrence', () => {
    const db = fixture({frequency:'once',anchor:'2026-10-12'});
    try {
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-10-20')).toHaveLength(1);
      db.prepare("UPDATE chore_schedules SET frequency='daily', end_date='2026-10-14' WHERE id='schedule'").run();
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-10-20').map(x=>x.startsOn)).toEqual(['2026-10-12','2026-10-13','2026-10-14']);
    } finally { db.close(); }
  });
  it('rejects invalid date formats and excessively large ranges', () => {
    const db = fixture();
    try {
      expect(()=>previewOccurrences(db,'schedule','10/12/2026','2026-10-13')).toThrow('Invalid local date');
      expect(()=>previewOccurrences(db,'schedule','2026-10-12','2028-10-12')).toThrow('Date range');
    } finally {db.close();}
  });

  it('accepts valid weekday boundaries and deduplicates weekdays in normalized output', () => {
    const db = fixture({ weekdays: [0, 0, 6, 6] });
    try {
      const occurrences = previewOccurrences(db, 'schedule', '2026-10-12', '2026-10-18');
      expect(occurrences.map(x => x.startsOn)).toEqual(['2026-10-12', '2026-10-18']);
      expect(occurrences.map(x => x.key)).toEqual(['schedule:2026-10-12', 'schedule:2026-10-18']);
    } finally { db.close(); }
  });
  it('generates weekly chores only on selected weekdays', () => {
    const db = fixture({frequency:'weekly', weekdays:[1,4]});
    try {
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-10-25').map(x=>x.startsOn))
        .toEqual(['2026-10-13','2026-10-16','2026-10-20','2026-10-23']);
      expect(generateOccurrences(db,'schedule','2026-10-12','2026-10-25')).toHaveLength(4);
    } finally { db.close(); }
  });
  it('covers weekly and interval scheduling branches with and without weekday filters', () => {
    const db = fixture({frequency:'interval_weeks',interval:2});
    try {
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-11-02').map(x=>x.startsOn))
        .toEqual(['2026-10-12','2026-10-26']);
      db.prepare("UPDATE chore_schedules SET frequency='interval_days', interval_count=2, weekdays='[0]' WHERE id='schedule'").run();
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-10-26').map(x=>x.startsOn))
        .toEqual(['2026-10-12','2026-10-26']);
      db.prepare("UPDATE chore_schedules SET frequency='interval_weeks', interval_count=2, weekdays='[1]' WHERE id='schedule'").run();
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-11-02').map(x=>x.startsOn))
        .toEqual(['2026-10-13','2026-10-27']);
    } finally { db.close(); }
  });
  it('handles flexible weeks before an anchor and at the end date', () => {
    const db = fixture({frequency:'weekly',anchor:'2026-10-21',end:'2026-10-27'});
    try {
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-11-08').map(x=>x.startsOn))
        .toEqual(['2026-10-19','2026-10-26']);
    } finally { db.close(); }
  });
  it('rejects invalid intervals and handles ranges entirely before an anchor', () => {
    const db = fixture();
    try {
      expect(() => db.prepare("UPDATE chore_schedules SET interval_count=0 WHERE id='schedule'").run())
        .toThrow('CHECK constraint failed');
      db.prepare("UPDATE chore_schedules SET anchor_date='2026-10-20' WHERE id='schedule'").run();
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-10-14')).toEqual([]);
    } finally { db.close(); }
  });
  it('excludes a moved occurrence whose destination is outside the requested window', () => {
    const db = fixture();
    try {
      db.prepare("INSERT INTO occurrence_overrides (id,schedule_id,original_date,action,new_date) VALUES ('outside','schedule','2026-10-12','move','2026-10-25')").run();
      expect(previewOccurrences(db,'schedule','2026-10-12','2026-10-14').map(x=>x.key))
        .toEqual(['schedule:2026-10-13','schedule:2026-10-14']);
    } finally {db.close();}
  });
  it('rejects an invalid interval in a database with check enforcement disabled', () => {
    const db = fixture();
    try {
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.prepare("UPDATE chore_schedules SET interval_count=0 WHERE id='schedule'").run();
      db.exec('PRAGMA ignore_check_constraints = OFF');
      expect(()=>previewOccurrences(db,'schedule','2026-10-12','2026-10-14')).toThrow('Invalid interval');
    } finally {
      db.exec('PRAGMA ignore_check_constraints = OFF');
      db.close();
    }
  });
});
