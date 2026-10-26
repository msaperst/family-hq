export type HistoryStatus = 'completed' | 'skipped' | 'outstanding';
export interface HistoryEntry {
  id: string;
  name: string;
  dueOn: string;
  childId: string;
  childName: string;
  status: HistoryStatus;
}
export interface HistorySummary {
  completed: number;
  skipped: number;
  outstanding: number;
  total: number;
}
export interface HistoryResponse {
  from: string;
  through: string;
  today: string;
  entries: HistoryEntry[];
}
export function summarizeHistory(entries: readonly HistoryEntry[]): HistorySummary {
  const result = { completed: 0, skipped: 0, outstanding: 0, total: entries.length };
  for (const entry of entries) result[entry.status]++;
  return result;
}
