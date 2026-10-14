import { useCallback, useEffect, useState } from 'react';
import type { DashboardChore, DashboardResponse } from '../shared/dashboard';

const REFRESH_MS = 30_000;
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
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [today, setToday] = useState(phoenixDate);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/chores?more=${more}`, { signal });
      if (!response.ok) throw new Error('Unable to load chores');
      const result = await response.json() as DashboardResponse;
      if (!signal?.aborted) { setData(result); setError(''); setToday(result.today); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load chores');
    }
  }, [more]);
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
    {data && data.columns.length === 0 && <p className="empty">No chores scheduled. Everyone's caught up!</p>}
    {data && <div className="columns">
      {data.columns.map(column => <section className="column" key={column.id} aria-label={column.name}>
        <div className="column-heading"><h2>{column.name}</h2><p>{column.chores.filter(chore => chore.completed).length} completed</p></div>
        {groups.map(group => {
          if (group.id === 'upcoming' && !more) return null;
          const chores = column.chores.filter(chore => sectionFor(chore, today) === group.id);
          if (!chores.length) return null;
          return <section key={group.id} className="chore-group">
            <h3 className={group.id === 'overdue' ? 'overdue' : ''}>{group.title}</h3>
            {chores.map(chore => {
              const key = chore.id + ':' + (chore.childId ?? '');
              return <label className="chore" key={key}>
                <input type="checkbox" checked={chore.completed} disabled={pending.includes(key)} onChange={() => { void toggle(chore); }} />
                <span><span className={chore.completed ? 'chore-name completed' : 'chore-name'}>{chore.name}</span><small className={group.id === 'overdue' ? 'overdue' : ''}>{dueLabel(chore, today)}</small></span>
              </label>;
            })}
          </section>;
        })}
        {!more && column.chores.every(chore => sectionFor(chore, today) === 'upcoming') &&
          <p className="upcoming-hint">Chores coming up. Select “Show more upcoming chores” to see them.</p>}
      </section>)}
    </div>}
    <button type="button" className="show-more" onClick={() => setMore(value => !value)}>{more ? 'Hide upcoming chores' : 'Show more upcoming chores'}</button>
  </main>;
}
