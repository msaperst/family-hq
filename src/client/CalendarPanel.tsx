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
  const nextDay = dayStart + 86_400_000;
  return Date.parse(event.start) < nextDay && Date.parse(event.end) > dayStart;
}
export function CalendarPanel({ today }: { today: string }) {
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'stale' | 'unavailable'>('loading');
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
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [today]);
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  return <section className="calendar-panel" aria-label="Family calendar">
    <div className="calendar-heading">
      <h2>Family calendar</h2>
      {status === 'stale' && <span role="status">Showing saved events</span>}
      {status === 'unavailable' && <span role="status">Calendar unavailable · chores still work</span>}
    </div>
    {status === 'loading' && <p>Loading calendar…</p>}
    {status !== 'loading' && days.map(day => {
      const dayEvents = events.filter(event => occursOn(event, day));
      return <section className="calendar-day" key={day}>
        <h3>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(day + 'T00:00:00Z'))}{day === today ? ' · Today' : ''}</h3>
        {dayEvents.length === 0 ? <p className="calendar-empty">No events</p> : <ul>{dayEvents.map(event => <li key={event.id}>
          <time>{eventTime(event)}</time><span><strong>{event.title}</strong>{event.location && <small>{event.location}</small>}</span>
        </li>)}</ul>}
      </section>;
    })}
  </section>;
}
