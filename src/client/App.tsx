import { CalendarPanel } from './CalendarPanel';
import { dailyProgress, finishesDay } from './dailyProgress';
import { useCallback, useEffect, useRef, useState } from 'react';
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
export function sectionFor(chore: DashboardChore, today: string): 'overdue' | 'today' | 'available' | 'later' | 'upcoming' {
  if (chore.dueOn < today && !chore.completed) return 'overdue';
  if (chore.dueOn <= today) return 'today';
  // Multi-day chores can be done as soon as their window opens.
  if (chore.startsOn < chore.dueOn && chore.startsOn <= today) return 'available';
  if (chore.dueOn <= weekEnd(today)) return 'later';
  return 'upcoming';
}
export function visibleByDefault(chore: DashboardChore, today: string): boolean {
  const group = sectionFor(chore, today);
  if (group === 'overdue' || group === 'today' || group === 'available') return true;
  if (chore.completed && chore.dueOn >= today) return true;
  if (group !== 'later') return false;
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
  // A flexible multi-day obligation can be done any time before its deadline.
  // Ordinary future daily occurrences remain hidden until tomorrow.
  return chore.dueOn === tomorrow;
}
export function dueLabel(chore: DashboardChore, today: string): string {
  const delta = Math.round((Date.parse(chore.dueOn + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000);
  if (delta === -1) return 'Yesterday · Overdue';
  if (delta < -1) return `${-delta} days overdue`;
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (chore.startsOn < chore.dueOn && chore.startsOn <= today && chore.dueOn === weekEnd(today)) return 'Due Sunday';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(chore.dueOn + 'T00:00:00Z'));
}
const groups = [
  { id: 'overdue', title: 'Overdue' },
  { id: 'today', title: 'Due today' },
  { id: 'available', title: 'Available now' },
  { id: 'later', title: 'Due later' },
  { id: 'upcoming', title: 'Coming up' },
] as const;
interface SwipeChoreProps {
  readonly chore: DashboardChore;
  readonly today: string;
  readonly busy: boolean;
  readonly onComplete: (chore: DashboardChore) => void;
  readonly onSkip: (chore: DashboardChore) => void;
}
export function SwipeChore({ chore, today, busy, onComplete, onSkip }: Readonly<SwipeChoreProps>) {
  const [revealed, setRevealed] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const gesture = useRef(false);
  const skipLabel = chore.skipped ? 'Undo skip' : 'Skip';
  let choreNameClass = 'chore-name';
  if (chore.completed) choreNameClass += ' completed';
  else if (chore.skipped) choreNameClass += ' skipped';
  return <div className={`swipe-chore${revealed ? ' revealed' : ''}${chore.skipped ? ' is-skipped' : ''}`}>
    {!chore.skipped && <button className="swipe-action" type="button" disabled={busy || chore.completed}
      onClick={() => { setRevealed(false); onSkip(chore); }}>{skipLabel}</button>}
    <div className="swipe-face" onPointerDown={event => {
      if ((event.target as HTMLElement).closest('input,button')) return;
      origin.current = { x: event.clientX, y: event.clientY };
      gesture.current = false;
    }} onPointerUp={event => {
      const start = origin.current;
      origin.current = null;
      if (!start) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        setRevealed(dx < 0);
        gesture.current = true;
      }
    }} onClickCapture={event => {
      if (gesture.current) { event.preventDefault(); event.stopPropagation(); gesture.current = false; }
    }}>
      <label className="chore">
        <input type="checkbox" aria-label={`${chore.name} · ${dueLabel(chore, today)}`}
          checked={chore.completed} disabled={busy || chore.skipped}
          onChange={() => onComplete(chore)} />
        <span><span className={choreNameClass}>{chore.name}</span>
          <small>{chore.skipped ? `Skipped · ${dueLabel(chore, today)}` : dueLabel(chore, today)}</small></span>
      </label>
      <button type="button" className="chore-more" aria-label={`Actions for ${chore.name}`}
        aria-expanded={revealed} onClick={() => setRevealed(value => !value)}>⋯</button>
    </div>
    {chore.skipped && !revealed && <button className="skip-undo-inline" type="button" disabled={busy}
      onClick={() => onSkip(chore)}>Undo skip</button>}
  </div>;
}

export function App() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/health', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((health: { revision?: string } | null) => {
        if (!controller.signal.aborted && health && typeof health.revision === 'string') setRevision(health.revision);
      })
      .catch(() => { /* Version is informational; never block household chores. */ });
    return () => controller.abort();
  }, []);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [error, setError] = useState('');
  const [completionError, setCompletionError] = useState('');
  const [loadedWeeks, setLoadedWeeks] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const loadingMoreRef = useRef(false);
  const weeksRef = useRef(1);
  const baseDayRef = useRef(phoenixDate());
  const MAX_WEEKS = 13;
  const [pending, setPending] = useState<string[]>([]);
  const [celebration, setCelebration] = useState<{ columnId: string; stamp: number } | null>(null);
  useEffect(() => {
    if (!celebration) return;
    const timeout = setTimeout(() => setCelebration(null), 2400);
    return () => clearTimeout(timeout);
  }, [celebration]);
  const [today, setToday] = useState(phoenixDate);
  const [undoEntries, setUndoEntries] = useState<UndoEntry[]>([]);
  useEffect(() => {
    if (!undoEntries.length) return;
    const delay = Math.max(0, Math.min(...undoEntries.map(entry => entry.expiresAt)) - Date.now());
    const timeout = setTimeout(() => setUndoEntries(entries => entries.filter(entry => entry.expiresAt > Date.now())), delay);
    return () => clearTimeout(timeout);
  }, [undoEntries]);
  useEffect(() => {
    // Only ask about onboarding after the dashboard confirms it has no chore columns.
    // Normal household dashboards must not generate an extra parent API request.
    if (!data || data.columns.length > 0) { setNeedsSetup(false); return; }
    const controller = new AbortController();
    void fetch('/api/parent/children', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json() as { children: { id: string }[] };
        if (!controller.signal.aborted) setNeedsSetup(result.children.length === 0);
      })
      .catch(() => { /* Do not advertise setup during a network failure. */ });
    return () => controller.abort();
  }, [data?.columns.length]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/chores?date=${baseDayRef.current}&more=false`, { signal });
      if (!response.ok) throw new Error('Unable to load chores');
      const result = await response.json() as DashboardResponse;
      if (!signal?.aborted) { setData(previous => { if (!previous || weeksRef.current === 1 || previous.today !== result.today) { return result; } const first = new Map(result.columns.map(column => [column.id, column])); return { ...previous, columns: previous.columns.map(column => { const fresh = first.get(column.id); const byId = new Map(column.chores.map(chore => [chore.id + ':' + chore.childId, chore])); for (const chore of fresh?.chores ?? []) { byId.set(chore.id + ':' + chore.childId, chore); } return { ...column, chores: [...byId.values()] }; }).concat(result.columns.filter(column => !previous.columns.some(existing => existing.id === column.id))) }; }); setError(''); setToday(result.today); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load chores');
    }
  }, []);
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || weeksRef.current >= MAX_WEEKS || !data) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(false);
    const from = new Date(Date.parse(baseDayRef.current + 'T00:00:00Z') + weeksRef.current * 7 * 86_400_000).toISOString().slice(0, 10);
    try {
      const response = await fetch(`/api/chores?date=${from}&window=true`);
      if (!response.ok) throw new Error('Unable to load more chores');
      const next = await response.json() as DashboardResponse;
      setData(previous => { if (!previous) { return next; } const columns = new Map(previous.columns.map(column => [column.id, { ...column, chores: [...column.chores] }])); for (const column of next.columns) { const existing = columns.get(column.id); if (!existing) { columns.set(column.id, column); continue; } const known = new Set(existing.chores.map(chore => chore.id + ':' + chore.childId)); for (const chore of column.chores) { if (!known.has(chore.id + ':' + chore.childId)) { existing.chores.push(chore); known.add(chore.id + ':' + chore.childId); } } } return { ...previous, through: next.through, columns: [...columns.values()] }; });
      weeksRef.current += 1;
      setLoadedWeeks(weeksRef.current);
    } catch { setMoreError(true); }
    finally { loadingMoreRef.current = false; setLoadingMore(false); }
  }, [data]);
  const onChoreScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight < 250 && !moreError) void loadMore(); }, [loadMore, moreError]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = setInterval(() => { const current = phoenixDate(); if (current !== baseDayRef.current) { baseDayRef.current = current; weeksRef.current = 1; setLoadedWeeks(1); setData(null); } setToday(current); void refresh(controller.signal); }, REFRESH_MS);
    const visible = () => { if (!document.hidden) void refresh(controller.signal); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  async function toggle(chore: DashboardChore) {
    const key = chore.id + ':' + (chore.childId ?? '');
    if (pending.includes(key)) return;
    setCompletionError('');
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
      if (!chore.completed && data) {
        const columnId = chore.mode === 'either' ? 'either' : chore.childId;
        const column = data.columns.find(candidate => candidate.id === columnId);
        if (column && finishesDay(column.chores, today, chore)) {
          setCelebration({ columnId: column.id, stamp: Date.now() });
        }
      }
    } catch (cause) {
      setCompletionError(cause instanceof Error ? cause.message : 'Could not save completion');
    } finally {
      setPending(previous => previous.filter(item => item !== key));
    }
  }
  async function toggleSkip(chore: DashboardChore) {
    const key = chore.id + ':' + (chore.childId ?? '');
    if (pending.includes(key)) return;
    setCompletionError('');
    setPending(previous => [...previous, key]);
    try {
      const response = await fetch(`/api/chores/${encodeURIComponent(chore.id)}/skip`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ childId: chore.childId, skipped: !chore.skipped }),
      });
      if (!response.ok) throw new Error('Could not save skip');
      if (chore.dueOn < today) {
        if (!chore.skipped) {
          const columnId = chore.mode === 'either' ? 'either' : chore.childId!;
          setUndoEntries(entries => [...entries.filter(entry => entry.chore.id !== chore.id), {
            chore: { ...chore, skipped: true }, columnId, expiresAt: Date.now() + OVERDUE_UNDO_MS,
          }]);
        } else {
          setUndoEntries(entries => entries.filter(entry => entry.chore.id !== chore.id));
        }
      }
      await refresh();
    } catch (cause) {
      setCompletionError(cause instanceof Error ? cause.message : 'Could not save skip');
    } finally {
      setPending(previous => previous.filter(item => item !== key));
    }
  }
  return <main className="dashboard">
    <header className="dashboard-header dashboard-header-centered">
      <div><h1>Family HQ</h1><p>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'full' }).format(new Date(today + 'T00:00:00Z'))}</p></div>

    </header>
    <div className="dashboard-content"><div className="chores-panel">
    {!data && !error && <p>Loading chores…</p>}
    {(data || error) && <div className="columns" style={{ '--chore-column-count': data?.columns.length || 1 } as React.CSSProperties}>
      {(data?.columns.length ? data.columns : [{ id: "chores", name: "Chores", chores: [] }]).map(column => {
        const retained = undoEntries.filter(entry => entry.columnId === column.id && entry.expiresAt > Date.now() && !column.chores.some(chore => chore.id === entry.chore.id));
        const choresForColumn = [...column.chores.map(chore => undoEntries.find(entry => entry.chore.id === chore.id)?.chore ?? chore), ...retained.map(entry => entry.chore)];
        const progress = dailyProgress(choresForColumn, today);
        return <section className="column" key={column.id} aria-label={column.name}>
        <div className="column-heading"><h2>{column.name}</h2><p>{progress.total ? `${progress.completed} of ${progress.total} done today` : "No chores due today"}</p>{progress.allDone && <p className="daily-all-done" role="status">✓ All done for today!</p>}{celebration?.columnId === column.id && <div className="chore-confetti" key={celebration.stamp} aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--piece": i } as React.CSSProperties} />)}</div>}</div>
        <div className="column-body" onScroll={onChoreScroll}>
        {data?.columns.length === 0 && <><p className="chore-empty-state">No chores scheduled. Everyone's caught up!</p>{needsSetup && <p className="chore-setup-link">First time here? <a href="/settings">Set up your household</a> to add children and chores.</p>}</>}
        {error && <p role="alert" className="panel-error">{data ? "Showing saved chores — unable to refresh" : "Unable to load chores"}</p>}
        {completionError && <p role="alert" className="panel-error">{completionError}</p>}
        {groups.map(group => {
          const chores = choresForColumn.filter(chore => (undoEntries.some(entry => entry.chore.id === chore.id) ? 'overdue' : sectionFor(chore, today)) === group.id);
          if (!chores.length) return null;
          return <section key={group.id} className="chore-group">
            <h3 className={group.id === 'overdue' ? 'overdue' : ''}>{group.title}</h3>
            {chores.map(chore => {
              const key = chore.id + ':' + (chore.childId ?? '');
              return <SwipeChore key={key} chore={chore} today={today} busy={pending.includes(key)} onComplete={item => { void toggle(item); }} onSkip={item => { void toggleSkip(item); }} />;
            })}
          </section>;
        })}
        {loadingMore && <output className="calendar-empty">Loading more chores…</output>}
        {moreError && <button type="button" className="agenda-more" onClick={() => void loadMore()}>Retry loading chores</button>}
        {data && data.columns.length > 0 && loadedWeeks < MAX_WEEKS && !loadingMore && !moreError && <button type="button" className="agenda-more" onClick={() => void loadMore()}>Load more chores</button>}
        </div>
      </section>; })}
    </div>}
    </div><CalendarPanel today={today} /></div>
    {revision && <footer className="dashboard-version" title={`Deployed revision: ${revision}`}>Version: {revision === 'development' ? revision : revision.slice(0, 7)}</footer>}
  </main>;
}
