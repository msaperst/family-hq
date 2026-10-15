# Google Calendar integration (issue #11)

Family HQ reads the existing shared family calendar **server-side**. It never creates, updates, or deletes Google events. The browser only calls `GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD`; `to` is exclusive. Maximum window: 90 days. Events preserve Google-provided offsets and all-day exclusive end dates. The UI in issue #12 will render these in America/Phoenix.

## One-time OAuth setup

1. In Google Cloud Console, enable the Google Calendar API, configure the OAuth consent screen and create an OAuth client for a one-time authorization flow.
2. Authorize the Google account that can view the existing shared family calendar, requesting only `https://www.googleapis.com/auth/calendar.events.readonly`. Obtain an offline refresh token using a trusted local OAuth client or Google OAuth Playground configured with **your own** client credentials. Do not commit tokens or paste them into issues/logs.
3. Find the shared calendar ID in Google Calendar settings. Set the following server-side environment variables through a private secret mechanism:
   - `FAMILY_HQ_GOOGLE_CALENDAR_ID`
   - `FAMILY_HQ_GOOGLE_CLIENT_ID`
   - `FAMILY_HQ_GOOGLE_CLIENT_SECRET`
   - `FAMILY_HQ_GOOGLE_REFRESH_TOKEN`
4. Restart the server and request `/api/calendar/events?from=2026-10-15&to=2026-10-22`. Without configuration the endpoint responds 503; no Google account is required for local automated tests.

**Security:** Never expose OAuth credentials in Vite `VITE_*` variables, browser bundles, git, or client API responses. Use read-only scope and restrict calendar access to the trusted LAN. The Google API is queried only through fixed Google endpoints; the calendar ID is URL-encoded.

**Behavior:** OAuth access tokens are refreshed in memory, event responses are cached for five minutes, pagination is supported, and a previously cached matching range is returned with `stale: true` if Google fails. If no matching cached range exists, the endpoint returns 503 without leaking credentials. Rate limits are not retried aggressively. All-day events use exclusive end dates; timed events retain ISO offsets. The server never mutates calendar events.

**Testing:** `npm run test:integration` exercises normalization, OAuth refresh, pagination, cache fallback, and request validation with mocked HTTP. No live credentials in CI.
