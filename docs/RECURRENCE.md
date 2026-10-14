# Recurrence engine operations

The recurrence engine in `src/server/recurrence.ts` reads stored schedules and generates stable dated chore occurrences. It uses calendar-day arithmetic on ISO `YYYY-MM-DD` dates; no device timezone, local clock time, or 24-hour elapsed-duration arithmetic is used. Household dates are interpreted in the `America/Phoenix` calendar.

## Configure a schedule

A schedule belongs to a chore in `chore_schedules`. Its `anchor_date` is the first eligible date and the reference for rotation. Set `frequency` to `once`, `daily`, `weekly`, `interval_days`, or `interval_weeks`; `interval_count` must be positive. `weekdays` is a JSON array of numbers **0=Monday through 6=Sunday**. For a weekly schedule, an empty array means **one flexible obligation per Monday–Sunday week**; otherwise selected weekdays each produce an occurrence.

Add eligible children to `schedule_assignees` with distinct `rotation_order` values. With `rotation=none`, `mode=individual` requires one assignee; `either` shares a completion and `each` creates independent completion targets. With `rotation=daily` or `weekly`, the generator selects one child by anchored rotation order and produces an individual obligation.

Add a dated `occurrence_overrides` record to skip, move, or reassign one occurrence. The `original_date` identifies the original occurrence and its stable key, even if its date is moved.

## Preview, generate, verify

Call `previewOccurrences(db, scheduleId, from, to)` to inspect results without database writes. Call `generateOccurrences(db, scheduleId, from, to)` to persist them. Dates are inclusive and ranges are limited to 366 days per call. Rerunning generation is idempotent for identical schedule definitions; stored completion history is retained.

```sh
cd family-hq
npm ci
npm run typecheck
npm run test:unit
npm run test:coverage
npm run build
```

Inspect generated data with SQLite: `SELECT occurrence_key, starts_on, due_on, mode, status FROM chore_occurrences ORDER BY starts_on;` and `SELECT occurrence_id, child_id FROM occurrence_assignees ORDER BY occurrence_id, child_id;`. Completion state is stored separately in `chore_completions` and `completion_events`.

**Editing an already-generated occurrence:** Generation intentionally rejects conflicting stored occurrence data rather than rewriting history. Plan changes with an effective date and generate future dates only. To change an existing obligation safely, use a dedicated editing workflow that preserves completion history rather than deleting and recreating it.

## Troubleshooting

- Missing occurrence: check anchor/end dates, `paused`, selected weekdays, and interval.
- Wrong rotating child: check `rotation_order`, anchor date, and daily versus weekly rotation.
- Duplicate/conflict error: compare stored occurrence key, date range, mode, and assignees before rerunning.
- Invalid date or weekday: use real ISO calendar dates and weekday numbers 0–6.
