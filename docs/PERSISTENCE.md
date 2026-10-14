# Chore persistence

The application uses SQLite through Node 22's built-in `node:sqlite` API. This avoids native npm packages and keeps the production image small. Node 22 may print an experimental API warning; pinning/upgrading the Node runtime should be reviewed before production deployment.

## Data location

- Local development: `FAMILY_HQ_DB_PATH=./data/family-hq.sqlite` (relative to the working directory).
- Compose: `/app/data/family-hq.sqlite` on the named volume `family-hq-data`. This persists through container recreation, but **not** `docker compose down -v`.
- No existing NAS directories, S3 backup jobs, or networking are changed. The volume is **not yet covered by the existing backup strategy** until #13–#15 select a host path and verify coverage.

On startup, the server creates its database directory, enables foreign keys, busy timeout, and WAL journaling, applies versioned transactional migrations, and checks database integrity. Startup fails if the database cannot be opened or migrated. Avoid multiple server processes sharing one database until concurrent access has been tested.

## Local checks

```sh
cd family-hq
npm ci
npm run typecheck
npm test
npm run build
docker compose up --build -d
docker compose ps
docker compose restart family-hq
docker compose logs family-hq
```

Restart must retain the database volume. To inspect the named volume, run `docker volume ls`; Compose prefixes volume names with the project name.

## Consistent backup and restore

Do not copy only the live `.sqlite` file in WAL mode: uncheckpointed transactions may be in the `-wal` file. The `backupDatabase(db, target)` helper uses SQLite `VACUUM INTO` to produce a consistent standalone snapshot. Choose a **new** destination path each time; verify the snapshot by opening it and running `PRAGMA integrity_check`. Never overwrite a live database in place.

Restore only while the application is stopped, from a validated standalone snapshot, preserving file ownership/permissions. A complete automated backup and restore drill is planned for #15; no existing backup jobs have been modified.

## Scope

Issue #6 provides schema, migrations, persistence primitives, and tests. Issue #7 will generate dated occurrences from recurrence rules and overrides; issue #8 will expose API endpoints. No spreadsheet import, seed data, or UI editing is performed here.
