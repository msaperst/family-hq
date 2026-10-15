import { useEffect, useState } from 'react';

export interface FamilyEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
}
const TIME_ZONE = 'America/Phoenix';
function localDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function addDays(day: string, days: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}
export function eventDay(event: FamilyEvent): string {
  return event.allDay ? event.start : localDay(new Date(event.start));
}
export function eventTime(event: FamilyEvent): string {
  if (event.allDay) return 'All day';
  return new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(event.start));
}
export function occursOn(event: FamilyEvent, day: string): boolean {
  if (event.allDay) return event.start <= day && day < event.end;
  const dayStart = Date.parse(day + 'T00:00:00-07:00');
  return Date.parse(event.start) < dayStart + 86_400_000 && Date.parse(event.end) > dayStart;
}
export function activeAgenda(events: FamilyEvent[], now: Date): FamilyEvent[] {
  const day = localDay(now);
  return events.filter(event => event.allDay
    ? event.end > day
    : Date.parse(event.end) > now.getTime())
    .sort((a, b) => {
      const aStart = a.allDay ? a.start + 'T00:00:00-07:00' : a.start;
      const bStart = b.allDay ? b.start + 'T00:00:00-07:00' : b.start;
      return Date.parse(aStart) - Date.parse(bStart);
    });
}
export function isInProgress(event: FamilyEvent, now: Date): boolean {
  return !event.allDay && Date.parse(event.start) <= now.getTime() && Date.parse(event.end) > now.getTime();
}
export function CalendarPanel({ today }: { today: string }) {
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'stale' | 'unavailable'>('loading');
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/calendar/events?from=' + today + '&to=' + addDays(today, 8), { signal: controller.signal });
        if (!response.ok) throw new Error('Calendar unavailable');
        const result = await response.json() as { events: FamilyEvent[]; stale: boolean };
        if (!controller.signal.aborted) {
          setEvents(result.events);
          setStatus(result.stale ? 'stale' : 'ready');
        }
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      }
    };
    void load();
    const interval = setInterval(() => { void load(); }, 5 * 60_000);
    const visible = () => { if (!document.hidden) { setNow(new Date()); void load(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [today]);
  const upcoming = activeAgenda(events, now);
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const visibleEvents = expanded ? upcoming : upcoming.slice(0, 5);
  return <section className="calendar-panel" aria-label="Family calendar">
    <div className="calendar-heading">
      <h2>{expanded ? 'This week' : 'Coming up'}</h2>
      <button type="button" className="calendar-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? 'Compact view' : 'Full week'}
      </button>
    </div>
    {status === 'stale' && <p role="status" className="calendar-status">Showing saved events</p>}
    {status === 'unavailable' && <p role="status" className="calendar-status">Calendar unavailable · chores still work</p>}
    {status === 'loading' && <p>Loading calendar…</p>}
    {status !== 'loading' && !expanded && <>
      {visibleEvents.length === 0 && <p className="calendar-empty">Nothing else scheduled this week.</p>}
      <ul className="agenda-list">{visibleEvents.map(event => <li key={event.id} className="agenda-event">
        <div className="agenda-meta">{eventTime(event)} · {new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(eventDay(event) + 'T00:00:00Z'))}</div>
        <strong>{event.title}</strong>
        {isInProgress(event, now) && <span className="agenda-live">In progress</span>}
        {event.location && <small title={event.location}>{event.location}</small>}
      </li>)}</ul>
      {upcoming.length > visibleEvents.length && <button type="button" className="agenda-more" onClick={() => setExpanded(true)}>View all {upcoming.length} upcoming events</button>}
    </>}
    {status !== 'loading' && expanded && <div className="calendar-week">{days.map(day => {
      const dayEvents = events.filter(event => occursOn(event, day));
      return <section className="calendar-day" key={day}>
        <h3>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(day + 'T00:00:00Z'))}{day === today ? ' · Today' : ''}</h3>
        {dayEvents.length === 0 ? <p className="calendar-empty">No events</p> : <ul>{dayEvents.map(event => <li key={event.id}>
          <time>{eventTime(event)}</time><span><strong>{event.title}</strong>{event.location && <small>{event.location}</small>}</span>
        </li>)}</ul>}
      </section>;
    })}</div>}
  </section>;
}
