import type { DashboardChore } from '../shared/dashboard';

export function dailyProgress(chores: DashboardChore[], today: string) {
  // Only obligations due today belong in today's denominator. Future and
  // overdue work remain visible in their own groups, without skewing progress.
  const due = chores.filter(chore => chore.dueOn === today);
  const completed = due.filter(chore => chore.completed).length;
  return { completed, total: due.length, allDone: due.length > 0 && completed === due.length };
}

export function finishesDay(chores: DashboardChore[], today: string, chore: DashboardChore): boolean {
  if (chore.completed || chore.dueOn !== today) return false;
  const before = dailyProgress(chores, today);
  return before.total > 0 && before.completed === before.total - 1;
}
