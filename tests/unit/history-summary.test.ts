import { describe, expect, it } from 'vitest';
import { summarizeHistory, type HistoryEntry } from '../../src/shared/history';

const entry = (id: string, status: HistoryEntry['status']): HistoryEntry => ({
  id, name: id, dueOn: '2026-10-26', childId: 'one', childName: 'One', status,
});

describe('summarizeHistory', () => {
  it('handles a window with no scheduled chores', () => {
    expect(summarizeHistory([])).toEqual({ completed: 0, skipped: 0, outstanding: 0, total: 0 });
  });
  it('counts each outcome independently without counting a skip as a completion', () => {
    const entries = [entry('a', 'completed'), entry('b', 'completed'), entry('c', 'skipped'), entry('d', 'outstanding')];
    expect(summarizeHistory(entries)).toEqual({ completed: 2, skipped: 1, outstanding: 1, total: 4 });
    expect(entries.map(x => x.status)).toEqual(['completed', 'completed', 'skipped', 'outstanding']);
  });
});
