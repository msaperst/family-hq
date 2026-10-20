# Family HQ chore model and spreadsheet migration

## Purpose

Define the behavior of chores, schedules, assignments, and completions independently of the source spreadsheet or UI. This contract guides database design, recurrence generation, API behavior, and parent editing. The existing private household spreadsheet is an import source, not the ongoing source of truth after an approved migration.

## Core concepts

- **Child:** a household participant (initially Child A and Child B); adding another child must not require schema changes.
- **Chore definition:** reusable name and optional description, independent of who performs it or when.
- **Schedule:** a recurrence rule with optional start/end dates and a household-local timezone (`America/Phoenix`).
- **Assignment:** eligible children and completion mode for a schedule or one-time chore.
- **Occurrence:** a dated instance generated deterministically from a schedule, or a one-time assignment. A weekly flexible occurrence spans a defined week rather than a particular day.
- **Completion:** the status of one occurrence (or one child-specific obligation), with completion timestamp and optional performer. Completion records are separate from schedule definitions.
- **Override:** a dated exception to skip, move, replace, or reassign an occurrence without rewriting the entire series.

## Assignment and completion modes

| Mode | Semantics | Example |
| --- | --- | --- |
| Individual | One child is responsible; one completion | Child A's cello practice |
| Either | Two or more eligible children see **one shared obligation**; completion by either completes it for everyone | Shared household task |
| Each | One independent obligation per assigned child; one child's completion does not complete the other's | Child A and Child B each shower |

An `either` occurrence appears in each eligible child's view but must have a single shared completion state and must not inflate household totals. Record the performer if known; do not infer who performed it from which tablet was used. With no child login, performer attribution is optional or explicitly selected. Unchecking reverses the relevant completion without altering other occurrences. Do not interpret a chore appearing separately under both children in the spreadsheet as `either` unless the user explicitly classifies it that way.

## Scheduling requirements

Support:

- One-time chore on a date, optionally assigned to one child, either child, or each child.
- Daily and selected weekdays (including weekends).
- Weekly on a selected weekday, and **once any time during a week** (one obligation due by week end).
- Every N days or N weeks with a stable anchor date.
- Alternating assignees by day or by week, with an explicit anchor and rotation order.
- Optional effective start/end dates; pause/resume; individual date skips, moves, and reassignment.
- Multiple schedules for one chore if needed, without merging distinct obligations.

Generate occurrences idempotently using stable schedule/occurrence identity. Use local calendar dates, not elapsed 24-hour intervals, to avoid date drift. Preserve historical occurrences and completions when a parent changes future schedules; changes take effect from an explicit date. For weekly chores, define Monday–Sunday household weeks. Avoid creating a second weekly obligation when regenerating or importing the same period.

## Current source-of-truth baseline

For initial migration and schedule inference, use **two adjacent sample weeks** in the current-year tab of the Kid Chores sheet. These are the most recently updated intended schedules as of the baseline review date. Older weeks (including the prior-year tab) are reference examples only and must **not** be imported as active recurrence rules. The importer must read both weeks because alternating assignments may only be evident across weeks.

Representative patterns observed in the two baseline weeks:

| Pattern | Representative chores | Modeling note |
| --- | --- | --- |
| Daily individual | Child A's 30 Pushups; Child B's Put Shoes in Closet | Same child, daily occurrence |
| Selected weekdays | Homework; Hebrew Practice; Writing Practice; Cello | Only create occurrences on listed days |
| Alternating children | Feed pets, Refill pet water, Get mail, Set/Clear table, Take recycling out | Infer candidate rotations from both weeks; require review before turning observations into rules |
| Individual for both | Shower | Separate Child A and Child B obligations on their scheduled dates |
| Specific-date/weekend | Clean Room, bathrooms, trash/recycling to street, Clean pet enclosure | Preserve date-specific assignments; do not assume all weekend work is a stable weekly rule |
| Flexible once weekly | Child A: Load Dishwasher; Child B: Help Cook Dinner | One occurrence per child per week; no assigned weekday |

The baseline includes Clean pet enclosure and Replace pet bedding as distinct names from Refill pet water. Preserve these distinctions unless a parent intentionally merges chore definitions. Do not infer shared `either` semantics merely because two children can do similar chores.

## Import contract

1. **Read only:** never modify the original Google Sheet.
2. **Parse structure:** locate weekly date headings, weekday columns, Child A/Child B sections, checkbox/chore pairs, and the separate `Once A Week` section. Do not rely on fixed row offsets. Older sheet layouts differ; the initial active import targets only the two specified 2026 weeks.
3. **Normalize:** emit candidate chore definitions, dated assignments, checkbox states, and proposed recurrence rules with source coordinates (tab, row, column, week). Distinguish blank cells from explicit unchecked checkboxes.
4. **Review:** show a dry-run preview of proposed rules, individual exceptions, conflicting/ambiguous rotations, and counts. Flag assumptions for confirmation; never silently invent missing dates or assignees.
5. **Apply only after approval:** import in a transaction with a source fingerprint and stable external keys so repeated runs do not duplicate records. Reconcile changed source values explicitly; do not overwrite user-edited schedules or completions.
6. **Rollback:** identify records belonging to the import batch and reverse only changes safe to undo; preserve subsequent manual edits and unrelated data. Provide a report of anything requiring manual resolution.
7. **Audit:** record import timestamp, source range/version, approved mapping, warnings, and imported record counts. Never store Google credentials in source control.

Checkboxes in the spreadsheet represent historical observed states for their specific dated occurrences, not the definition of a recurrence. The initial migration must explicitly decide whether to bring those completion states across; do not infer that unchecked means overdue.

## Validation examples

Automated tests for #5–#8 should cover:

- Daily and selected-weekday generation, including no occurrence on excluded days.
- A weekly flexible task completed once, not seven times.
- Alternation between Child A and Child B across the two adjacent sample weeks, with an anchored rotation and no accidental reset at month/year boundaries.
- `either`: one shared completion from either view, one household total.
- `each`: independent shower completions for Child A and Child B.
- One-off skips/reassignments without changing other weeks.
- Rerunning import/generation without duplicate definitions or occurrences.
- Preserving historical completions after schedule changes, and preserving manual edits during import rollback.
- Source parsing with variable row positions, empty cells, and the `Once A Week` section.

## Implementation boundaries

This document specifies behavior; it does not prescribe the final SQLite/Drizzle table layout. #5 owns source analysis and the dry-run/import design; #6 owns persistence and migrations; #7 owns recurrence and overrides; #8 owns API contracts; #10 owns parent schedule editing. No live spreadsheet edits or production data migration are authorized by this specification.
