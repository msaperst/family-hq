# Rolling agenda layout (#12)

The main Family HQ dashboard prioritizes the existing interactive chore columns. On wide landscape screens the chores use 70% of the content area, with a compact calendar agenda in the remaining 30%. On portrait tablets the agenda appears above two chore columns; phones stack chore columns.

The compact agenda displays the next five relevant events, hides timed events at their end time, keeps in-progress events, and retains all-day events until their exclusive end date in America/Phoenix. Event visibility recalculates every minute locally without extra API calls. The Google Calendar API is fetched every five minutes and on tab visibility changes. The Full week control expands a seven-day calendar; Compact view returns to the agenda.

The calendar API can be unavailable without disabling chores. A stale API response is labeled. Event locations are truncated in compact mode, with the full value available as a title.

Run typecheck, unit/integration tests, build, and Playwright checks locally before a PR. Add iPad-sized viewport coverage before merging issue #12.
