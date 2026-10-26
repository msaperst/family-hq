import { useEffect, useMemo, useState } from 'react';
import type { HistoryEntry, HistoryResponse, HistoryStatus } from '../shared/history';
import { summarizeHistory } from '../shared/history';

const states: Record<HistoryStatus, string> = {
  completed: 'Completed', skipped: 'Skipped', outstanding: 'Outstanding',
};
const prettyDay = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
function dates(from: string, through: string): string[] {
  const days: string[] = [];
  for (let ms = Date.parse(from + 'T00:00:00Z'); ms <= Date.parse(through + 'T00:00:00Z'); ms += 86_400_000) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}
export function HistoryDashboard() {
  const [days, setDays] = useState<7 | 30>(7);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [child, setChild] = useState('all');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setError('');
    void fetch('/api/history?days=' + days, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load chore history');
        return response.json() as Promise<HistoryResponse>;
      })
      .then(result => { if (!controller.signal.aborted) setHistory(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load chore history. Try refreshing.'); });
    return () => controller.abort();
  }, [days]);
  const children = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of history?.entries ?? []) names.set(entry.childId, entry.childName);
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [history]);
  const entries = useMemo(() => (history?.entries ?? []).filter(entry => child === 'all' || entry.childId === child), [history, child]);
  const summary = summarizeHistory(entries);
  const rate = summary.total ? Math.round(100 * summary.completed / summary.total) : 0;
  const timeline = history ? dates(history.from, history.through).reverse() : [];
  return <main className="history-dashboard">
    <header className="history-header">
      <div><a href="/" className="history-back">← Family HQ</a><h1>Chore history</h1><p>See how the household has been doing, without treating skipped chores as completed.</p></div>
      <div className="history-controls">
        <div className="history-period" role="group" aria-label="Date range">
          <button type="button" aria-pressed={days === 7} onClick={() => setDays(7)}>7 days</button>
          <button type="button" aria-pressed={days === 30} onClick={() => setDays(30)}>30 days</button>
        </div>
        <label>Show <select aria-label="Child" value={child} onChange={event => setChild(event.target.value)}>
          <option value="all">Everyone</option>
          {children.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
      </div>
    </header>
    {error && <p role="alert" className="history-error">{error}</p>}
    {!history && !error && <p role="status">Loading history…</p>}
    {history && <>
      <section className="history-metrics" aria-label="Chore summary">
        <div className="history-metric"><span>Completion rate</span><strong>{rate}%</strong><small>{summary.completed} of {summary.total} scheduled</small></div>
        <div className="history-metric complete"><span>Completed</span><strong>{summary.completed}</strong><small>Finished chores</small></div>
        <div className="history-metric skipped"><span>Skipped</span><strong>{summary.skipped}</strong><small>Intentionally cleared</small></div>
        <div className="history-metric outstanding"><span>Outstanding</span><strong>{summary.outstanding}</strong><small>Not yet resolved</small></div>
      </section>
      <section className="history-section">
        <div className="history-section-heading"><h2>Daily activity</h2><span>{prettyDay(history.from)} – {prettyDay(history.through)}</span></div>
        <div className="history-legend"><span className="legend-completed">Completed</span><span className="legend-skipped">Skipped</span><span className="legend-outstanding">Outstanding</span></div>
        <div className="history-bars">
          {timeline.slice().reverse().map(day => {
            const today = entries.filter(entry => entry.dueOn === day);
            const stat = summarizeHistory(today);
            const pct = (count: number) => stat.total ? count / stat.total * 100 + '%' : '0%';
            return <div className="history-bar-row" key={day}>
              <time dateTime={day}>{prettyDay(day)}</time>
              <div className="history-stack" aria-label={stat.completed + ' completed, ' + stat.skipped + ' skipped, ' + stat.outstanding + ' outstanding'}>
                <span className="bar-completed" style={{ width: pct(stat.completed) }} />
                <span className="bar-skipped" style={{ width: pct(stat.skipped) }} />
                <span className="bar-outstanding" style={{ width: pct(stat.outstanding) }} />
              </div><span className="history-bar-total">{stat.completed}/{stat.total}</span>
            </div>;
          })}
        </div>
      </section>
      <section className="history-section">
        <h2>Day-by-day details</h2>
        <div className="history-days">
          {timeline.map(day => {
            const items = entries.filter(entry => entry.dueOn === day);
            const stat = summarizeHistory(items);
            return <details key={day} className="history-day" open={day === history.through}>
              <summary><span>{prettyDay(day)}</span><small>{stat.completed} completed · {stat.skipped} skipped · {stat.outstanding} outstanding</small></summary>
              {items.length ? <ul>{items.map((entry: HistoryEntry) => <li key={entry.id + ':' + entry.childId}>
                <span className={'history-status ' + entry.status}>{states[entry.status]}</span>
                <span className="history-chore-name">{entry.name}</span>
                <small>{entry.childName}</small>
              </li>)}</ul> : <p>No chores due this day.</p>}
            </details>;
          })}
        </div>
      </section>
    </>}
  </main>;
}
