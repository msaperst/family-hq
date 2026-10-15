# Unified calendar and chores dashboard (#12)

The main Family HQ page displays the upcoming seven Phoenix-local calendar days above the existing interactive chore columns. The calendar reads `GET /api/calendar/events` (issue #11) and never sends Google credentials to the browser. The calendar refreshes every five minutes and on tab visibility changes; chores continue refreshing every 30 seconds.

The server may return stale cached calendar events (`stale: true`), which the UI labels. If the calendar API is unavailable, the UI shows a nonblocking message and leaves the chore controls usable. Timed events are formatted in `America/Phoenix`; all-day events use Google's exclusive end date. A week crossing a month or year works without special configuration.

The layout uses seven columns on wide screens and stacked days on narrow tablets/phones. Tests cover UTC-to-Phoenix conversion, multi-day events, and midnight boundaries. Run `npm run typecheck`, `npm run test:unit`, `npm run test:coverage`, and the existing Playwright suite before merging. iPad-sized Playwright coverage is a follow-up within this issue.
