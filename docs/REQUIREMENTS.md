# Family HQ requirements

**Status:** MVP scope agreed; detailed chore rules require validation against the existing sheet in [#5](https://github.com/msaperst/home-lab/issues/5).

## Users and devices

- Child A and Child B should see their own chores clearly.
- Household members should be able to interact from the existing iPad mini, phones and a possible future kiosk.
- Chore completion should be a single large tap, without sign-in friction.

## MVP functional requirements

1. Show today's and the week's chores grouped by child and date.
2. Check and uncheck individual dated chores; show the persisted state immediately.
3. Preserve completion across page reloads, container restarts and changes to future recurring rules.
4. Support recurring tasks by weekday or schedule, rotating assignments, and one-day exceptions.
5. Handle America/Phoenix local dates consistently at day and week boundaries.
6. Reflect changes from another household screen after a short refresh interval.
7. Provide a separate interface to maintain chore definitions, schedules and overrides.
8. Keep the current Google Calendar display usable throughout development.
9. Provide automated verification for recurrence, assignment rotation, API updates, persistence and core touchscreen interactions.

## Chore data migration

The current household chores spreadsheet has 2025 and 2026 tabs and is a reference, not a live database. Analyze actual task names, day patterns, rotation anchors, exceptions and historical entries before finalizing the importer. Start with a dry-run preview and avoid modifying the original sheet.

## Calendar integration (after chore MVP)

- Read events from the existing shared Google Calendar.
- Handle timed and all-day events, date boundaries, API errors and cached display.
- Combine calendar and chores into one dashboard without changing Google events.

## Nonfunctional requirements

- Touch targets and typography suitable for an iPad mini and glanceable family display.
- Responsive layout for portrait/landscape and phone use.
- Trusted-LAN-only service in v1; no internet exposure of unauthenticated chore mutation endpoints.
- Persistent, backed-up storage and documented restore procedure.
- CI checks, automated tests, code review and reproducible Docker deployment.
- Accessible controls with visible loading, success and failure states.

## Out of scope for the first usable chore release

- Alexa integration or external access.
- Dedicated touchscreen hardware purchase.
- Rewards, points, gamification and notifications.
- Household user accounts, child-specific authentication or attribution of who tapped a checkbox.
- Two-way Google Calendar or Google Sheets synchronization.
- Weather, monitoring or other general home-dashboard features.

## MVP acceptance

On a trusted household device, a family member can open the chores page, see the correct daily assignments for both children, check/uncheck tasks, refresh or reopen the app without losing progress, and observe changes from a second device. Recurrence and rotation behavior is verified by tests. The existing calendar continues working independently.

## Tracking

Foundation: #3–#4; chore model and API: #5–#8; interface: #9–#10; calendar/dashboard: #11–#12; operations: #13–#15; future extensions: #16–#18.
