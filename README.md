# Family HQ

A self-hosted, touchscreen-friendly family dashboard that combines **recurring chores** with a **read-only Google Calendar agenda**. Built using React, TypeScript, Fastify, and SQLite.

> This repository was extracted from the private [Home Lab](https://github.com/msaperst/home-lab) project. It is currently private while deployment, CI, and public-release readiness are reviewed.

## Features

- Two-column chore dashboard with due dates, overdue items, completion, and undo
- Recurring schedules, rotating assignments, overrides, and flexible weekly tasks
- Parent settings for maintaining chore schedules
- Seven-day Google Calendar agenda with server-side OAuth and cache fallback
- Touch-friendly responsive layout for tablets and phones
- Persistent SQLite data; no required external database service

## Get started

Requirements: Node.js 22 and npm.

```sh
cp .env.example .env
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The API defaults to port `3080`. Calendar integration requires server-side OAuth configuration; the chore dashboard and tests do not require Google credentials.

Run checks:

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

A local Docker smoke environment is available with `docker compose up --build -d`. Its HTTP port binds to loopback, and **it is not a production deployment configuration**. Never run `docker compose down -v` against a volume whose data you need.

## Documentation

- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development and CI](docs/DEVELOPMENT.md)
- [Chore model](docs/CHORE_MODEL.md)
- [API](docs/API.md)
- [Google Calendar setup](docs/GOOGLE_CALENDAR.md)
- [SQLite persistence and backup](docs/PERSISTENCE.md)
- [Browser tests](docs/BROWSER_TESTS.md)

## Deployment and security

The production deployment to the QNAP NAS, automation, backup and restore remain tracked in [issues #1–#3](https://github.com/msaperst/family-hq/issues). Keep all OAuth credentials and household data outside Git. The v1 chore API trusts the local network and is **not safe to expose directly to the public Internet**. Use a separate authenticated boundary for external integrations.

## Project history

The original development and merged pull requests remain in `msaperst/home-lab`. This repository preserves the extracted `family-hq/` Git history. The open backlog has been migrated to this repository.
