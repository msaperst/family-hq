import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { calendarSettings, GoogleCalendar, normalizeEvent, registerCalendarApi } from '../../src/server/calendar.js';

describe('Google Calendar read-only integration', () => {
  const settings = { calendarId: 'family@example.com', clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh' };
  it('requires complete configuration but allows disabled integration', () => {
    expect(calendarSettings({})).toBeNull();
    expect(() => calendarSettings({ FAMILY_HQ_GOOGLE_CLIENT_ID: 'client' })).toThrow('Incomplete');
  });
  it('normalizes all-day and timed events, ignoring cancelled events', () => {
    expect(normalizeEvent({ id: 'a', start: { date: '2026-10-15' }, end: { date: '2026-10-16' } }))
      .toMatchObject({ id: 'a', allDay: true, start: '2026-10-15', end: '2026-10-16' });
    expect(normalizeEvent({ id: 'b', start: { dateTime: '2026-10-15T09:00:00-07:00' },
      end: { dateTime: '2026-10-15T10:00:00-07:00' } })).toMatchObject({ allDay: false });
    expect(normalizeEvent({ id: 'c', status: 'cancelled' })).toBeNull();
  });
  it('refreshes token, paginates events, caches and serves stale data on Google failures', async () => {
    let time = 0;
    const request = vi.fn(async (url: string | URL) => {
      if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'access', expires_in: 3600 }), { status: 200 });
      if (time > 300_000) return new Response('unavailable', { status: 429 });
      const token = new URL(String(url)).searchParams.get('pageToken');
      return new Response(JSON.stringify(token ? { items: [{ id: 'b', start: { date: '2026-10-16' }, end: { date: '2026-10-17' } }] } :
        { items: [{ id: 'a', start: { date: '2026-10-15' }, end: { date: '2026-10-16' } }], nextPageToken: 'next' }));
    }) as unknown as typeof fetch;
    const calendar = new GoogleCalendar(settings, request, () => time);
    const from = '2026-10-15T00:00:00-07:00', to = '2026-10-20T00:00:00-07:00';
    expect((await calendar.events(from, to)).events).toHaveLength(2);
    expect((await calendar.events(from, to)).stale).toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
    time = 301_000;
    expect(await calendar.events(from, to)).toMatchObject({ stale: true, events: [{ id: 'a' }, { id: 'b' }] });
  });
  it('validates API date ranges and does not expose Google errors', async () => {
    const app = buildApp();
    registerCalendarApi(app, null);
    try {
      expect((await app.inject('/api/calendar/events?from=bad&to=2026-10-20')).statusCode).toBe(400);
      expect((await app.inject('/api/calendar/events?from=2026-10-15&to=2026-10-20')).statusCode).toBe(503);
    } finally { await app.close(); }
  });
});
