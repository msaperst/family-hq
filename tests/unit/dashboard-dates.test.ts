import { describe, expect, it } from 'vitest';
import { dateOffset, localToday } from '../../src/server/dashboard.js';
import { dueLabel, sectionFor, visibleByDefault } from '../../src/client/App.js';
import type { DashboardChore } from '../../src/shared/dashboard.js';

const chore = (dueOn: string, completed = false): DashboardChore => ({
  id: 'a', name: 'Chore', startsOn: dueOn, dueOn, mode: 'individual', childId: 'alex', completed,
});
describe('dashboard dates', () => {
  it('calculates Phoenix dates across UTC boundaries', () => {
    expect(localToday(new Date('2026-10-15T04:00:00Z'))).toBe('2026-10-14');
    expect(localToday(new Date('2026-10-15T07:00:00Z'))).toBe('2026-10-15');
  });
  it('handles date arithmetic and invalid dates', () => {
    expect(dateOffset('2026-12-31', 1)).toBe('2027-01-01');
    expect(() => dateOffset('2026-02-30', 1)).toThrow('Invalid date');
  });
  it('labels overdue, today, tomorrow and week-end', () => {
    const today = '2026-10-14';
    expect(dueLabel(chore('2026-10-13'), today)).toBe('Yesterday · Overdue');
    expect(dueLabel(chore('2026-10-12'), today)).toBe('2 days overdue');
    expect(dueLabel(chore(today), today)).toBe('Today');
    expect(dueLabel(chore('2026-10-15'), today)).toBe('Tomorrow');
    expect(dueLabel(chore('2026-10-18'), today)).toBe('End of week · Sunday');
  });
  it('keeps tomorrow and flexible weekly chores visible without flooding future daily chores', () => {
    const today = '2026-10-14';
    expect(visibleByDefault(chore('2026-10-13'), today)).toBe(true);
    expect(visibleByDefault(chore(today), today)).toBe(true);
    expect(visibleByDefault(chore('2026-10-15'), today)).toBe(true);
    expect(visibleByDefault(chore('2026-10-16'), today)).toBe(false);
    expect(visibleByDefault(chore('2026-10-16', true), today)).toBe(true);
    expect(visibleByDefault(chore('2026-10-19'), today)).toBe(false);
    expect(visibleByDefault({ ...chore('2026-10-18'), startsOn: '2026-10-12' }, today)).toBe(true);
    expect(visibleByDefault({ ...chore('2026-10-18'), startsOn: '2026-10-17' }, today)).toBe(false);
  });
  it('handles Sunday boundaries and completed future chores', () => {
    const sunday = '2026-10-18';
    expect(sectionFor(chore('2026-10-19'), sunday)).toBe('upcoming');
    expect(visibleByDefault(chore('2026-10-19'), sunday)).toBe(false);
    expect(visibleByDefault(chore('2026-10-19', true), sunday)).toBe(true);
    expect(visibleByDefault(chore('2026-10-18'), sunday)).toBe(true);
    expect(dueLabel(chore('2026-10-21'), sunday)).toContain('Wednesday');
  });
  it('does not display completed overdue chores as overdue', () => {
    const today = '2026-10-14';
    expect(sectionFor(chore('2026-10-12', true), today)).toBe('today');
    expect(visibleByDefault(chore('2026-10-12', true), today)).toBe(true);
  });
  it('shows flexible obligations that started today but are due later', () => {
    const today = '2026-10-14';
    const flexible = { ...chore('2026-10-17'), startsOn: today };
    expect(visibleByDefault(flexible, today)).toBe(true);
  });
  it('groups overdue, due today, later this week and beyond', () => {
    const today = '2026-10-14';
    expect(sectionFor(chore('2026-10-13'), today)).toBe('overdue');
    expect(sectionFor(chore('2026-10-13', true), today)).toBe('today');
    expect(sectionFor(chore(today), today)).toBe('today');
    expect(sectionFor(chore('2026-10-18'), today)).toBe('later');
    expect(sectionFor(chore('2026-10-19'), today)).toBe('upcoming');
  });
});
