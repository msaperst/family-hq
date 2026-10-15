import type { FastifyInstance } from 'fastify';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
}
interface GoogleEvent {
  id?: string; summary?: string; location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  status?: string;
}
interface GoogleList { items?: GoogleEvent[]; nextPageToken?: string }
export interface CalendarSettings {
  calendarId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}
export function calendarSettings(env: NodeJS.ProcessEnv): CalendarSettings | null {
  const names = ['FAMILY_HQ_GOOGLE_CALENDAR_ID', 'FAMILY_HQ_GOOGLE_CLIENT_ID',
    'FAMILY_HQ_GOOGLE_CLIENT_SECRET', 'FAMILY_HQ_GOOGLE_REFRESH_TOKEN'] as const;
  if (names.every(name => !env[name])) return null;
  if (names.some(name => !env[name]?.trim())) throw new Error('Incomplete Google Calendar configuration');
  return { calendarId: env[names[0]]!, clientId: env[names[1]]!,
    clientSecret: env[names[2]]!, refreshToken: env[names[3]]! };
}
export function normalizeEvent(event: GoogleEvent): CalendarEvent | null {
  if (!event.id || event.status === 'cancelled' || !event.start || !event.end) return null;
  const allDay = Boolean(event.start.date && event.end.date);
  const start = allDay ? event.start.date : event.start.dateTime;
  const end = allDay ? event.end.date : event.end.dateTime;
  if (!start || !end) return null;
  return { id: event.id, title: event.summary ?? '(Untitled)', start, end,
    allDay, location: event.location ?? null };
}
export class GoogleCalendar {
  private cached: { key: string; expires: number; events: CalendarEvent[] } | null = null;
  private token: { value: string; expires: number } | null = null;
  constructor(private readonly settings: CalendarSettings,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now) {}
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > this.now()) return this.token.value;
    const response = await this.request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret,
        refresh_token: this.settings.refreshToken, grant_type: 'refresh_token' }),
    });
    if (!response.ok) throw new Error('Google Calendar authorization failed');
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('Google Calendar token missing');
    this.token = { value: data.access_token, expires: this.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000 };
    return this.token.value;
  }
  async events(from: string, to: string): Promise<{ events: CalendarEvent[]; stale: boolean }> {
    const key = from + '/' + to;
    if (this.cached?.key === key && this.cached.expires > this.now()) return { events: this.cached.events, stale: false };
    try {
      const token = await this.accessToken();
      const items: CalendarEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const url = new URL('https://www.googleapis.com/calendar/v3/calendars/' +
          encodeURIComponent(this.settings.calendarId) + '/events');
        url.searchParams.set('timeMin', from);
        url.searchParams.set('timeMax', to);
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('maxResults', '250');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await this.request(url, { headers: { authorization: 'Bearer ' + token } });
        if (!response.ok) throw new Error('Google Calendar events request failed: HTTP ' + response.status);
        const data = await response.json() as GoogleList;
        items.push(...(data.items ?? []).map(normalizeEvent).filter((event): event is CalendarEvent => event !== null));
        pageToken = data.nextPageToken;
        if (!pageToken) {
          this.cached = { key, events: items, expires: this.now() + 5 * 60_000 };
          return { events: items, stale: false };
        }
      }
      throw new Error('Google Calendar pagination limit exceeded');
    } catch (error) {
      if (this.cached?.key === key) return { events: this.cached.events, stale: true };
      throw error;
    }
  }
}
const validDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date + 'T00:00:00Z')) &&
  new Date(Date.parse(date + 'T00:00:00Z')).toISOString().slice(0, 10) === date;
export function registerCalendarApi(app: FastifyInstance, calendar: GoogleCalendar | null): void {
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/calendar/events', async (request, reply) => {
    const { from, to } = request.query;
    if (!from || !to || !validDate(from) || !validDate(to) || from >= to ||
      (Date.parse(to) - Date.parse(from)) / 86_400_000 > 90) {
      return reply.code(400).send({ error: 'Invalid calendar date range (maximum 90 days)' });
    }
    if (!calendar) return reply.code(503).send({ error: 'Calendar not configured' });
    try {
      const start = from + 'T00:00:00-07:00';
      const end = to + 'T00:00:00-07:00';
      return await calendar.events(start, end);
    } catch (error) {
      request.log.error({ err: error }, 'Calendar retrieval failed');
      return reply.code(503).send({ error: 'Calendar temporarily unavailable' });
    }
  });
}
