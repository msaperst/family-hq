import { CalendarPanel } from './CalendarPanel';
import { useCallback, useEffect, useState } from 'react';
import type { DashboardChore, DashboardResponse } from '../shared/dashboard';

const REFRESH_MS = 30_000;
export const OVERDUE_UNDO_MS = 30_000;
type UndoEntry = { chore: DashboardChore; columnId: string; expiresAt: number };
function phoenixDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function weekEnd(today: string): string {
  const date = new Date(today + 'T00:00:00Z');
  const offset = (7 - date.getUTCDay()) % 7;
  return new Date(date.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}
export function sectionFor(chore: DashboardChore, today: string): 'overdue' | 'today' | 'later' | 'upcoming' {
  if (chore.dueOn < today && !chore.completed) return 'overdue';
  if (chore.dueOn <= today) return 'today';
  if (chore.dueOn <= weekEnd(today)) return 'later';
  return 'upcoming';
}
export function visibleByDefault(chore: DashboardChore, today: string): boolean {
  const group = sectionFor(chore, today);
  if (group === 'overdue' || group === 'today') return true;
  if (chore.completed && chore.dueOn >= today) return true;
  if (group !== 'later') return false;
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
  // A flexible multi-day obligation can be done any time before its deadline.
  // Ordinary future daily occurrences remain hidden until tomorrow.
  return chore.dueOn === tomorrow || (chore.startsOn < chore.dueOn && chore.startsOn <= today);
}
export function dueLabel(chore: DashboardChore, today: string): string {
  const delta = Math.round((Date.parse(chore.dueOn + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000);
  if (delta === -1) return 'Yesterday · Overdue';
  if (delta < -1) return `${-delta} days overdue`;
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (chore.dueOn === weekEnd(today)) return 'End of week · Sunday';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(chore.dueOn + 'T00:00:00Z'));
}
const groups = [
  { id: 'overdue', title: 'Overdue' },
  { id: 'today', title: 'Due today' },
  { id: 'later', title: 'Due later' },
  { id: 'upcoming', title: 'Coming up' },
] as const;
export function App() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [today, setToday] = useState(phoenixDate);
  const [undoEntries, setUndoEntries] = useState<UndoEntry[]>([]);
  useEffect(() => {
    if (!undoEntries.length) return;
    const delay = Math.max(0, Math.min(...undoEntries.map(entry => entry.expiresAt)) - Date.now());
    const timeout = setTimeout(() => setUndoEntries(entries => entries.filter(entry => entry.expiresAt > Date.now())), delay);
    return () => clearTimeout(timeout);
  }, [undoEntries]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/chores?more=true`, { signal });
      if (!response.ok) throw new Error('Unable to load chores');
      const result = await response.json() as DashboardResponse;
      if (!signal?.aborted) { setData(result); setError(''); setToday(result.today); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load chores');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = setInterval(() => { setToday(phoenixDate()); void refresh(controller.signal); }, REFRESH_MS);
    const visible = () => { if (!document.hidden) void refresh(controller.signal); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  async function toggle(chore: DashboardChore) {
    const key = chore.id + ':' + (chore.childId ?? '');
    if (pending.includes(key)) return;
    setPending(previous => [...previous, key]);
    try {
      const response = await fetch(`/api/chores/${encodeURIComponent(chore.id)}/completion`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ childId: chore.childId, completed: !chore.completed }),
      });
      if (!response.ok) throw new Error('Could not save completion');
      if (chore.dueOn < today) {
        if (!chore.completed) {
          // Individual/each chores are assigned to a child by the dashboard API.
          const columnId = chore.mode === 'either' ? 'either' : chore.childId!;
          setUndoEntries(entries => [...entries.filter(entry => entry.chore.id !== chore.id), {
            chore: { ...chore, completed: true }, columnId, expiresAt: Date.now() + OVERDUE_UNDO_MS,
          }]);
        } else {
          setUndoEntries(entries => entries.filter(entry => entry.chore.id !== chore.id));
        }
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save completion');
    } finally {
      setPending(previous => previous.filter(item => item !== key));
    }
  }
  return <main className="dashboard">
    <header className="dashboard-header">
      <div><h1>Family HQ</h1><p>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'full' }).format(new Date(today + 'T00:00:00Z'))}</p></div>
      <span className="connection">{error ? 'Connection issue' : 'Connected'}</span>
    </header>
    {error && <p role="alert" className="error">{error}</p>}
    {!data && !error && <p>Loading chores…</p>}
    {data?.columns.length === 0 && <p className="empty">No chores scheduled. Everyone's caught up!</p>}
    <div className="dashboard-content"><div className="chores-panel">
    {data && <div className="columns">
      {data.columns.map(column => {
        const retained = undoEntries.filter(entry => entry.columnId === column.id && entry.expiresAt > Date.now() && !column.chores.some(chore => chore.id === entry.chore.id));
        const choresForColumn = [...column.chores.map(chore => undoEntries.some(entry => entry.chore.id === chore.id) ? { ...chore, completed: true } : chore), ...retained.map(entry => entry.chore)];
        return <section className="column" key={column.id} aria-label={column.name}>
        <div className="column-heading"><h2>{column.name}</h2><p>{choresForColumn.filter(chore => chore.completed).length} completed</p></div>
        {groups.map(group => {
          const chores = choresForColumn.filter(chore => (undoEntries.some(entry => entry.chore.id === chore.id) ? 'overdue' : sectionFor(chore, today)) === group.id);
          if (!chores.length) return null;
          return <section key={group.id} className="chore-group">
            <h3 className={group.id === 'overdue' ? 'overdue' : ''}>{group.title}</h3>
            {chores.map(chore => {
              const key = chore.id + ':' + (chore.childId ?? '');
              return <label className="chore" key={key}>
                <input type="checkbox" aria-label={`${chore.name} · ${dueLabel(chore, today)}`} checked={chore.completed} disabled={pending.includes(key)} onChange={() => { void toggle(chore); }} />
                <span><span className={chore.completed ? 'chore-name completed' : 'chore-name'}>{chore.name}</span><small className={group.id === 'overdue' ? 'overdue' : ''}>{dueLabel(chore, today)}</small></span>
              </label>;
            })}
          </section>;
        })}
      </section>; })}
    </div>}
    </div><CalendarPanel today={today} /></div>
  </main>;
}
