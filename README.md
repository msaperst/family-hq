# Family HQ

A self-hosted household dashboard for chores and, later, the shared family calendar. Designed for an iPad mini, phones, and an optional future wall/fridge touchscreen.

**Status:** architecture approved; implementation not started. [Planning issue #2](https://github.com/msaperst/home-lab/issues/2).

## Goals

- Show each child's chores for today and the week.
- Allow anyone on the trusted household network to check or uncheck chores without logging in.
- Support recurring and rotating assignments, exceptions, and completion history.
- Eventually combine chores with the existing shared Google Calendar.
- Run in Docker on the QNAP NAS, with tested backups and a reproducible development process.

## Documentation

- [Requirements](docs/REQUIREMENTS.md) — user behavior, MVP, exclusions and acceptance criteria.
- [Architecture](docs/ARCHITECTURE.md) — design decisions, data ownership, topology and security.
- [Development](docs/DEVELOPMENT.md) — branch/PR policy, testing standards and implementation workflow.

## Implementation tracking

Work is split into [GitHub issues](https://github.com/msaperst/home-lab/issues). Start with [#3 — application skeleton](https://github.com/msaperst/home-lab/issues/3) and [#4 — CI and testing](https://github.com/msaperst/home-lab/issues/4).

No application runtime, Docker commands, API endpoints, or deployment scripts exist yet. Add verified instructions as each implementation ticket is completed.
