import { describe, expect, it } from 'vitest';
import { dailyProgress, finishesDay } from '../../src/client/dailyProgress';
import type { DashboardChore } from '../../src/shared/dashboard';

const today = '2026-10-20';
function chore(id: string, dueOn = today, completed = false): DashboardChore {
  return { id, name: id, startsOn: dueOn, dueOn, completed, mode: 'individual', childId: 'child-1' };
}

describe('daily progress', () => {
  it('counts due today, not future tasks or old overdue items', () => {
    expect(dailyProgress([chore('a', today, true), chore('b'), chore('future', '2026-10-21'), chore('old', '2026-10-19')], today))
      .toEqual({ completed: 1, total: 2, allDone: false });
  });
  it('shows all done only when at least one chore is due and all are complete', () => {
    expect(dailyProgress([chore('a', today, true)], today).allDone).toBe(true);
    expect(dailyProgress([chore('later', '2026-10-21')], today).allDone).toBe(false);
  });
  it('celebrates only a new completion of the final outstanding due-today chore', () => {
    const chores = [chore('a', today, true), chore('b'), chore('future', '2026-10-21')];
    expect(finishesDay(chores, today, chores[1])).toBe(true);
    expect(finishesDay(chores, today, chores[0])).toBe(false);
    expect(finishesDay(chores, today, chores[2])).toBe(false);
    expect(finishesDay([chore('a'), chore('b')], today, chore('a'))).toBe(false);
  });
});
