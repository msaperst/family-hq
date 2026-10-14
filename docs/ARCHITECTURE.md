# Family HQ architecture

**Status:** approved design (2026-10-13); not yet implemented.  
**Decision record:** [#2](https://github.com/msaperst/home-lab/issues/2).

## Context and principles

Use the existing `home-lab` repository and QNAP infrastructure without reorganizing unrelated network and backup directories. Adopt the engineering practices from `saperstone-studios` (small feature branches, PRs, tests, CI and security checks), but use tooling appropriate to TypeScript rather than copying PHP workflows.

Prefer one deployable application over multiple services until there is a demonstrated need.

## Technology decisions

| Concern | Decision |
| --- | --- |
| UI | React, TypeScript, Vite |
| HTTP API | Node.js, TypeScript, Fastify |
| Input validation | Zod; share contracts where appropriate |
| Data | SQLite, persistent NAS volume |
| Schema | Versioned migrations; Drizzle ORM preferred, validate in #6 |
| Unit and integration tests | Vitest |
| Browser tests | Playwright |
| Container | Single production application image with compiled UI and API |
| Local orchestration | Docker Compose |
| CI and registry | GitHub Actions and GitHub Container Registry |
| Time zone | America/Phoenix |

The production image must not run tests as part of application startup or build orchestration. CI owns test execution.

## Logical architecture

```text
iPad mini / phones / future touchscreen
                |
        Trusted LAN + HTTPS
                |
       QNAP Docker Compose
       +--------------------+
       | Family HQ          |
       |  React frontend    |
       |  Fastify REST API  |
       |  chore engine      |
       +--------------------+
          |             |
  SQLite volume    Google Calendar API
  chores/history   read-only events

Future Alexa skill --> separately authenticated integration boundary
```

## Data ownership

- **Google Calendar** is the source of truth for family events; the first integration is read-only.
- **Family HQ SQLite** is the source of truth for chore definitions, recurrence rules, dated assignments, exceptions and completion history.
- The existing **Kid Chores Google Sheet** (2025 and 2026 tabs) is a read-only reference for analysis/import, not an ongoing second source of truth.
- Do not write chores into Google Calendar or mutate the source spreadsheet without a separate explicit decision.

Store dated occurrences independently of recurrence rules so that later rule edits do not silently rewrite historical completion records. Recurrence generation must be deterministic and idempotent. Define rotation anchors and overrides after inspecting the sheet in #5.

## Access and security

Household interactions must not require accounts, PINs or per-child identity. Anyone on the trusted LAN can check or uncheck chores. A separate management screen may be provided in v1, but it is not a security boundary.

**Important:** unauthenticated mutation endpoints must not be internet-facing. Keep Google credentials server-side, use minimum read-only Calendar scopes, never commit secrets, and add a distinct authenticated API boundary before implementing Alexa. Do not assume local DNS/HTTPS alone provides authorization.

## Network and hosting

The QNAP is on the upstream `192.168.0.x` network while household clients are generally on the pfSense-managed `192.168.1.x` network. Verify iPad-to-QNAP routing and narrowly scoped firewall rules before deployment. Reuse existing internal DNS and certificate management where appropriate; exact hostname and reverse-proxy placement remain implementation decisions for [#13](https://github.com/msaperst/home-lab/issues/13).

No changes to existing routing, certificate scripts or backup jobs are authorized by this document.

## Persistence and operations

- Mount SQLite data outside the container image; restarts and recreation must preserve it.
- Use versioned schema migrations and test migration/restart behavior.
- Back up SQLite with a consistent snapshot method (including WAL considerations), not an unsafe live file copy.
- Confirm coverage of the chosen NAS path by existing S3 backup routines before claiming protection.
- Provide health checks, useful logs, image pinning, rollback and a restore drill in [#13–#15](https://github.com/msaperst/home-lab/issues/13).

## Synchronization

Use API persistence and immediate UI feedback. Start with lightweight polling for changes made on other devices; only add push synchronization if testing or household use shows a need.

## Deferred decisions

- Final database library and native dependency packaging: #6 and #13.
- Spreadsheet rotation semantics: #5.
- Production image architecture, NAS volume path and HTTPS routing: #13.
- Deployment credentials, release and rollback automation: #14.
- Backup retention and tested restoration: #15.
- Alexa security and skill hosting: #16.

Update this document when implementation validates or changes a decision.
