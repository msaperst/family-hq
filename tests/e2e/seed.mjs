import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const filename = process.env.FAMILY_HQ_DB_PATH;
if (!filename || !filename.includes('family-hq-playwright-')) {
  throw new Error('Refusing to seed a non-Playwright database');
}
mkdirSync(dirname(resolve(filename)), { recursive: true });
const db = new DatabaseSync(filename);
db.exec('PRAGMA foreign_keys=ON');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = days => new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const monday = shift(-((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7));
try {
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO children (id,name) VALUES (?,?)').run('alex','Alex');
  db.prepare('INSERT INTO children (id,name) VALUES (?,?)').run('sam','Sam');
  for (const [id,name] of [['bed','Make bed'],['pets','Feed pets'],['room','Clean bedroom'],['laundry','Put laundry away'],['yesterday-done','Yesterday completed test chore'],['today-done','Today completed test chore']]) {
    db.prepare('INSERT INTO chores (id,name) VALUES (?,?)').run(id,name);
  }
  for (const [id,chore,mode,frequency,anchor] of [
    ['alex-bed','bed','individual','daily',today],
    ['sam-bed','bed','individual','daily',today],
    ['pets-shared','pets','either','daily',today],
    ['room-weekly','room','individual','weekly',monday],
  ]) {
    db.prepare('INSERT INTO chore_schedules (id,chore_id,mode,frequency,anchor_date) VALUES (?,?,?,?,?)').run(id,chore,mode,frequency,anchor);
  }
  for (const [schedule,child,order] of [
    ['alex-bed','alex',0],['sam-bed','sam',0],
    ['pets-shared','alex',0],['pets-shared','sam',1],
    ['room-weekly','alex',0],
  ]) db.prepare('INSERT INTO schedule_assignees (schedule_id,child_id,rotation_order) VALUES (?,?,?)').run(schedule,child,order);
  db.prepare('INSERT INTO chore_occurrences (id,occurrence_key,chore_id,starts_on,due_on,mode) VALUES (?,?,?,?,?,?)')
    .run('overdue-laundry','overdue-laundry','laundry',shift(-1),shift(-1),'individual');
  db.prepare('INSERT INTO occurrence_assignees (occurrence_id,child_id) VALUES (?,?)').run('overdue-laundry','alex');
  // Explicit completion fixtures for dashboard date-filtering assertions.
  for (const [id, due] of [['yesterday-done', shift(-1)], ['today-done', today]]) {
    db.prepare('INSERT INTO chore_occurrences (id, occurrence_key, chore_id, starts_on, due_on, mode) VALUES (?,?,?,?,?,?)')
      .run(id, id, id, due, due, 'individual');
    db.prepare('INSERT INTO occurrence_assignees (occurrence_id, child_id) VALUES (?,?)').run(id, 'alex');
    db.prepare('INSERT INTO chore_completions (occurrence_id, child_id, completed, performed_by, updated_at) VALUES (?, ?, 1, ?, ?)')
      .run(id, '', 'alex', new Date().toISOString());
  }
  db.exec('COMMIT');
  process.stdout.write('Seeded disposable Playwright DB for ' + today + '\n');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally { db.close(); }
