import { useCallback, useEffect, useRef, useState } from 'react';

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
export function CalendarPanel({ today }: Readonly<{ today: string }>) {
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'stale' | 'unavailable'>('loading');
  const [loadedDays, setLoadedDays] = useState(7);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const daysRef = useRef(7);
  const MAX_DAYS = 90;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    daysRef.current = 7;
    setLoadedDays(7);
    setHasMore(true);
    setLoadError(false);
    setEvents([]);
    setStatus('loading');
    const load = async () => {
      try {
        const response = await fetch('/api/calendar/events?from=' + today + '&to=' + addDays(today, 7), { signal: controller.signal });
        if (!response.ok) throw new Error('Calendar unavailable');
        const result = await response.json() as { events: FamilyEvent[]; stale: boolean };
        if (!Array.isArray(result?.events)) throw new Error('Invalid calendar response');
        if (!controller.signal.aborted) {
          setEvents(previous => {
            const merged = new Map(previous.map(event => [event.id, event]));
            for (const event of result.events) merged.set(event.id, event);
            return [...merged.values()];
          });
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

  const loadMore = useCallback(async () => {
    if (loadingRef.current || daysRef.current >= MAX_DAYS || status === 'loading') return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadError(false);
    const from = addDays(today, daysRef.current);
    const nextDays = Math.min(7, MAX_DAYS - daysRef.current);
    try {
      const response = await fetch('/api/calendar/events?from=' + from + '&to=' + addDays(from, nextDays));
      if (!response.ok) throw new Error('Could not load more events');
      const result = await response.json() as { events: FamilyEvent[]; stale: boolean };
      if (!Array.isArray(result?.events)) throw new Error('Invalid calendar response');
      setEvents(previous => {
        const merged = new Map(previous.map(event => [event.id, event]));
        for (const event of result.events) merged.set(event.id, event);
        return [...merged.values()];
      });
      daysRef.current += nextDays;
      setLoadedDays(daysRef.current);
      setHasMore(daysRef.current < MAX_DAYS);
      if (result.stale) setStatus('stale');
    } catch {
      setLoadError(true);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [today, status]);

  const onScroll = useCallback(() => {
    const node = scroller.current;
    if (node && node.scrollHeight - node.scrollTop - node.clientHeight < 250 && !loadError) {
      void loadMore();
    }
  }, [loadMore, loadError]);
  const upcoming = activeAgenda(events, now);
  const days = Array.from({ length: loadedDays }, (_, index) => addDays(today, index));
  return <section className="calendar-panel" aria-label="Family calendar">
    <div className="calendar-heading"><h2>Coming up</h2></div>
    <div className="calendar-body" ref={scroller} onScroll={onScroll}>
    {status === 'loading' && <p>Loading calendar…</p>}
    {status === 'unavailable' && <p role="alert" className="panel-error">{events.length ? "Showing saved calendar — unable to refresh" : "Unable to load calendar"}</p>}
    {status === 'stale' && <output className="panel-error">Showing saved calendar events</output>}
    {status !== 'loading' && <div className="calendar-agenda">
      {days.map(day => {
        const dayEvents = upcoming.filter(event => occursOn(event, day));
        if (!dayEvents.length) return null;
        return <section className="agenda-day" key={day}>
          <h3>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(day + 'T00:00:00Z'))}{day === today ? ' · Today' : ''}</h3>
          <ul className="agenda-list">{dayEvents.map(event => <li key={event.id} className="agenda-event">
            <div className="agenda-meta">{eventTime(event)}</div>
            <strong>{event.title}</strong>
            {isInProgress(event, now) && <span className="agenda-live">In progress</span>}
            {event.location && <small title={event.location}>{event.location}</small>}
          </li>)}</ul>
        </section>;
      })}
      {loadingMore && <output>Loading more events…</output>}
      {loadError && <button type="button" className="agenda-more" onClick={() => void loadMore()}>Retry loading events</button>}
      {!hasMore && <p className="calendar-empty">End of 90-day calendar window</p>}
      {hasMore && (status !== 'unavailable' || events.length > 0) && !loadingMore && !loadError && <button type="button" className="agenda-more" onClick={() => void loadMore()}>Load more events</button>}
    </div>}
    </div>
  </section>;
}
