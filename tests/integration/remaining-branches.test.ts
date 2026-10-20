import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../../src/server/app.js';
import { GoogleCalendar } from '../../src/server/calendar.js';
import { dashboard } from '../../src/server/dashboard.js';
import { openDatabase } from '../../src/server/db.js';

describe('remaining server boundary conditions', () => {
  it('rejects an occurrence assigned to a child absent from the active dashboard columns', () => {
    // Simulate inconsistent query snapshots: the occurrence query sees an active
    // child, but the subsequent child lookup no longer includes that child.
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => {
          if (sql.includes('FROM chore_schedules')) return [];
          if (sql.includes('FROM chore_occurrences')) return [{
            id: 'occurrence', name: 'Task', starts_on: '2026-10-15',
            due_on: '2026-10-15', mode: 'individual', child_id: 'missing', completed: 0,
          }];
          if (sql.includes('FROM children')) return [{ id: 'alex', name: 'Alex' }];
          throw new Error('Unexpected query');
        }),
      })),
    } as unknown as DatabaseSync;
    expect(() => dashboard(db, '2026-10-15')).toThrow('Active child missing from dashboard columns: missing');
  });

  it('stops Google pagination when the next page token is empty', async () => {
    const request = vi.fn(async (url: string | URL) => new Response(JSON.stringify(
      new URL(String(url)).origin === 'https://oauth2.googleapis.com'
        ? { access_token: 'token' }
        : { items: [], nextPageToken: '' },
    ), { status: 200 }));
    const calendar = new GoogleCalendar({
      calendarId: 'family@example.com', clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh',
    }, request as typeof fetch);
    expect(await calendar.events('2026-10-15', '2026-10-22')).toEqual({ events: [], stale: false });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('registers a configured calendar route when all Google settings are present', async () => {
    const keys = [
      'FAMILY_HQ_GOOGLE_CALENDAR_ID', 'FAMILY_HQ_GOOGLE_CLIENT_ID',
      'FAMILY_HQ_GOOGLE_CLIENT_SECRET', 'FAMILY_HQ_GOOGLE_REFRESH_TOKEN',
    ] as const;
    const previous = keys.map(key => process.env[key]);
    const db = openDatabase(':memory:');
    try {
      for (const key of keys) process.env[key] = 'test-value';
      const app = buildApp({ db });
      try {
        // An invalid range is rejected before any external request is attempted.
        const response = await app.inject('/api/calendar/events?from=invalid&to=2026-10-22');
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
      db.close();
    }
  });
});
