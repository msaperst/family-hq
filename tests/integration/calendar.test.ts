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
  it('accepts complete configuration and rejects blank secrets', () => {
    expect(calendarSettings({
      FAMILY_HQ_GOOGLE_CALENDAR_ID: settings.calendarId,
      FAMILY_HQ_GOOGLE_CLIENT_ID: settings.clientId,
      FAMILY_HQ_GOOGLE_CLIENT_SECRET: settings.clientSecret,
      FAMILY_HQ_GOOGLE_REFRESH_TOKEN: settings.refreshToken,
    })).toEqual(settings);
    expect(() => calendarSettings({ FAMILY_HQ_GOOGLE_CLIENT_ID: '  ' })).toThrow('Incomplete');
  });
  it('ignores malformed event entries and supplies missing display fields', () => {
    expect(normalizeEvent({ id: 'x', start: { date: '2026-10-15' }, end: {} })).toBeNull();
    expect(normalizeEvent({ id: 'x', start: { dateTime: '2026-10-15T10:00:00Z' }, end: {} })).toBeNull();
    expect(normalizeEvent({ id: 'x', start: { date: '2026-10-15' }, end: { date: '2026-10-16' } }))
      .toMatchObject({ title: '(Untitled)', location: null });
  });
  it.each([401, 403, 429, 500])('rejects Google events HTTP %i without cached data', async status => {
    const request = vi.fn(async (url: string | URL) =>
      new Response(String(url).includes('oauth2.googleapis.com')
        ? JSON.stringify({ access_token: 'access' }) : 'failure',
      { status: String(url).includes('oauth2.googleapis.com') ? 200 : status }));
    const calendar = new GoogleCalendar(settings, request as typeof fetch);
    await expect(calendar.events('start', 'end')).rejects.toThrow('events request failed');
  });
  it('rejects unsuccessful OAuth refresh and missing access tokens', async () => {
    const unauthorized = new GoogleCalendar(settings, vi.fn(async () => new Response('denied', { status: 401 })) as typeof fetch);
    await expect(unauthorized.events('start', 'end')).rejects.toThrow('authorization failed');
    const missingToken = new GoogleCalendar(settings, vi.fn(async () =>
      new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 })) as typeof fetch);
    await expect(missingToken.events('start', 'end')).rejects.toThrow('token missing');
  });
  it('rejects pagination overflow without publishing a partial cache', async () => {
    const request = vi.fn(async (url: string | URL) =>
      new Response(JSON.stringify(String(url).includes('oauth2.googleapis.com')
        ? { access_token: 'access' } : { items: [], nextPageToken: 'again' }), { status: 200 }));
    const calendar = new GoogleCalendar(settings, request as typeof fetch);
    await expect(calendar.events('start', 'end')).rejects.toThrow('pagination limit exceeded');
    expect(request).toHaveBeenCalledTimes(21);
  });
  it('returns a sanitized 503 from the HTTP endpoint when Google fails', async () => {
    const request = vi.fn(async (url: string | URL) =>
      new Response(String(url).includes('oauth2.googleapis.com')
        ? JSON.stringify({ access_token: 'access' }) : 'secret diagnostic',
      { status: String(url).includes('oauth2.googleapis.com') ? 200 : 503 }));
    const app = buildApp();
    registerCalendarApi(app, new GoogleCalendar(settings, request as typeof fetch));
    try {
      const response = await app.inject('/api/calendar/events?from=2026-10-15&to=2026-10-20');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'Calendar temporarily unavailable' });
      expect(response.body).not.toContain('secret diagnostic');
    } finally { await app.close(); }
  });
  it.each([
    'from=2026-10-15&to=2026-10-15',
    'from=2026-10-16&to=2026-10-15',
    'from=2026-02-30&to=2026-10-20',
    'from=2026-10-15&to=2027-02-01',
    'from=2026-10-15',
  ])('rejects invalid date range %s', async query => {
    const app = buildApp();
    registerCalendarApi(app, null);
    try {
      expect((await app.inject('/api/calendar/events?' + query)).statusCode).toBe(400);
    } finally { await app.close(); }
  });

});
