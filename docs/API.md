# Family HQ chore API

The API uses the existing SQLite database and the configured America/Phoenix household timezone. Start locally with `npm run dev` in `family-hq/`.

## Read dashboard

`GET /api/chores` returns `today`, `through`, and dynamic `columns`. Columns appear only when they have relevant chores. An `either` column appears only for shared obligations. The default horizon is seven days; `?more=true` extends it to 28 days. `?date=YYYY-MM-DD` is supported for deterministic local testing.

Each chore includes `id`, `name`, `startsOn`, `dueOn`, `mode`, `childId` (null for shared), and `completed`. The API generates scheduled occurrences on demand and retains persisted overdue unfinished occurrences. Weekly flexible chores remain a single obligation for the week.

`GET /api/children` lists active children.

## Completion

`PUT /api/chores/:id/completion` with JSON `{"childId":"child-id","completed":true}` completes an individual or each-child obligation. For an either-child chore, send `{"childId":null,"completed":true}`. Repeating the same request is idempotent and recorded only once. Setting `completed:false` unchecks it. Concurrent updates serialize using SQLite `BEGIN IMMEDIATE`.

By default, the UI shows overdue and today's chores, tomorrow's chores, active flexible multi-day chores due this week, and early-completed future chores. Other future daily chores are available through **Show more upcoming chores**. The dashboard polls every 30 seconds and refreshes on tab visibility changes. Its relative dates refresh automatically as the Phoenix date changes.

## Deployment boundary

These household endpoints have no account authentication. The server rejects non-private source IPs for household API routes (and does not trust forwarded headers). **Do not expose the service directly to the public internet.** Bind the server to loopback for development and restrict any NAS/LAN deployment using network/firewall/reverse-proxy controls before exposing it to household clients. A reverse proxy must also enforce its own trusted-client policy because the app sees the proxy's source IP. Alexa or remote access will require a separate authenticated boundary.
