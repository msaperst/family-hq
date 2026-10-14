# Family HQ database operations

This guide explains how to run, inspect, test, migrate, back up, and restore the SQLite database used by Family HQ. Run commands from `family-hq/` unless otherwise noted.

## Architecture and rationale

Family HQ stores its own chores and completion history in SQLite, separate from Google Calendar and the source chore spreadsheet. SQLite avoids running another database service on the NAS, supports transactions and foreign keys, and keeps local development close to production. The application uses Node 22's built-in `node:sqlite` API, so no native npm SQLite package needs installing. Node 22 emits an experimental-feature warning; this warning is expected and does not indicate corruption.

`src/server/db.ts` owns opening the database, schema migrations, and the snapshot helper. `src/server/chores.ts` contains persistence operations. `src/server/index.ts` opens the database before the HTTP server starts and closes it on Fastify shutdown.

The connection enables:

| Setting | Reason |
| --- | --- |
| `PRAGMA foreign_keys = ON` | Reject dangling child, chore, and schedule references; SQLite requires this per connection |
| `PRAGMA busy_timeout = 5000` | Wait briefly for concurrent locks rather than immediately failing |
| `PRAGMA journal_mode = WAL` | Allow readers while writes occur; creates companion `-wal` and `-shm` files |
| `PRAGMA integrity_check` | Reject a database that fails SQLite's structural integrity check at startup |

Use one application process per database until concurrent writers and deployment behavior are explicitly tested. SQLite is not a network database: the database files must live on a filesystem with reliable SQLite locking. Do not put them on an arbitrary network share without validating locking and WAL support.

## Run locally

Requires Node.js 22 and npm.

```sh
cd family-hq
npm ci
cp .env.example .env
npm run dev:server
```

The default `FAMILY_HQ_DB_PATH=./data/family-hq.sqlite` is resolved relative to the **current working directory**. The server creates the parent directory and database on first startup. `data/` and SQLite files are ignored by Git.

In another terminal, check the API:

```sh
curl --fail http://127.0.0.1:3080/api/health
```

Expected JSON: `{"status":"ok","service":"family-hq"}`. This proves the server started successfully, including database initialization; it does **not** prove chore APIs exist.

To use another database, change `FAMILY_HQ_DB_PATH` in `.env` before starting the server. Never point tests at a real household database.

## Run in Docker Compose

Requires Docker with Compose support.

```sh
cd family-hq
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 family-hq
curl --fail http://127.0.0.1:3080/api/health
```

Compose sets `FAMILY_HQ_DB_PATH=/app/data/family-hq.sqlite` and mounts the named volume `family-hq-data` at `/app/data`. The image runs as the non-root `node` user. The published HTTP port binds to host loopback, not every LAN interface.

```sh
docker compose restart family-hq
docker compose ps
docker volume ls
docker compose down
```

`docker compose down` keeps the named volume. **Do not run `docker compose down -v` against data you want to retain.** Compose prefixes the volume with its project name; check `docker volume ls` rather than assuming its exact host-side name. This volume is not automatically covered by your existing NAS/S3 backups.

## Inspect schema and database health

These commands run Node's SQLite client inside the running application container; no `sqlite3` CLI is required.

```sh
docker compose exec -T family-hq node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/app/data/family-hq.sqlite");
try {
  console.log("Migrations:", db.prepare("SELECT * FROM schema_migrations ORDER BY version").all());
  console.log("Integrity:", db.prepare("PRAGMA integrity_check").get());
  console.log("Children:", db.prepare("SELECT COUNT(*) AS count FROM children").get());
  console.log("Chores:", db.prepare("SELECT COUNT(*) AS count FROM chores").get());
} finally { db.close(); }
'
```

Expected: migration version `1` is present and `integrity_check` reports `ok`. Zero children or chores is normal before data is entered. Opening a separate SQLite connection for inspection is fine; do not make manual production edits through this connection.

For a failed startup, inspect `docker compose logs family-hq` first. Common causes are an unwritable volume, an invalid database path, a locked database, or a migration failure. Do not delete the database to make the error disappear.

## Schema and migrations

The initial schema defines `children`, `chores`, `chore_schedules`, `schedule_assignees`, `chore_occurrences`, `occurrence_assignees`, `chore_completions`, `completion_events`, and `occurrence_overrides`. The authoritative SQL is in `src/server/db.ts`; the behavior contract is in `docs/CHORE_MODEL.md`.

`openDatabase()` creates `schema_migrations` if necessary, then executes unapplied entries in the `migrations` array in order. Each migration and its version marker run inside one `BEGIN IMMEDIATE` transaction. Reopening the database does not reapply a recorded migration.

To change the schema:

1. Add a **new** SQL string at the end of the `migrations` array in `src/server/db.ts`. Do not edit previously released migration SQL; existing databases will not replay it.
2. Write tests that start from an older database, reopen with the new code, verify the new schema/data, and reopen a second time to confirm idempotency.
3. Test the upgrade against a **copy or consistent snapshot** of representative data, not the only copy of a household database.
4. Run the commands below and review migration results before deploying. Take a verified backup before applying a new version to live data.

Migration numbers are array positions starting at 1. SQLite DDL supports transactions for the statements used here, so failed migrations roll back rather than leaving a half-recorded version. There is currently no automatic downgrade mechanism; restore a pre-upgrade snapshot if rollback is necessary.

## Test and verify changes

```sh
cd family-hq
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e:persistence
```

The unit tests cover migration idempotency, foreign keys, assignment/completion semantics, separate calendar dates, event history, and standalone backup snapshots. The integration tests exercise Fastify request handling through `inject()` without binding an HTTP port. The Docker test builds an image, creates an isolated temporary Docker volume, writes a record, removes/recreates its container, verifies the record survives, runs `PRAGMA integrity_check`, and cleans up the test container and volume.

A passing Docker persistence test confirms container-recreation durability in the test environment; it does not verify NAS disaster recovery or the existing S3 backup pipeline. See `docs/TESTING.md` for the test-layer overview.

## Consistent backup

WAL mode can hold committed changes in the `-wal` file. **Do not copy only the live `.sqlite` file while the application is running.** The `backupDatabase(db, target)` helper in `src/server/db.ts` uses SQLite `VACUUM INTO` to create a transactionally consistent standalone database at a **new, nonexistent** destination.

For an on-demand snapshot from the running Compose container, use:

```sh
docker compose exec -T family-hq node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/app/data/family-hq.sqlite");
try {
  const target = "/app/data/backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite";
  db.exec("VACUUM INTO \'" + target + "\'");
  const snapshot = new DatabaseSync(target);
  try {
    if (snapshot.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Invalid snapshot");
  } finally { snapshot.close(); }
  console.log("Verified snapshot:", target);
} finally { db.close(); }
'
```

The snapshot is created **inside the same Docker volume**. It is not an off-device backup. Copy it to separately protected storage and verify that storage is included in your backup strategy. Keep the snapshot filename returned by the command; do not guess its timestamp.

## Restore from a verified snapshot

Restoration replaces application data. First verify the backup on a separate copy, and ensure you have an additional backup of the current database before proceeding. Stop the application before replacing any files.

```sh
docker compose stop family-hq
```

Locate the actual Compose volume with `docker volume ls` or `docker volume inspect`. Use a disposable helper container to inspect the mounted volume and the snapshot; do not run `docker compose down -v`. The application must remain stopped while the existing database and its `-wal`/`-shm` companions are moved aside and the verified snapshot is copied into place. Preserve ownership for the non-root `node` user. Then restart:

```sh
docker compose start family-hq
docker compose logs --tail=100 family-hq
curl --fail http://127.0.0.1:3080/api/health
```

Verify `PRAGMA integrity_check`, migration version, and representative chore records using the inspection command above. Avoid a blind overwrite of a running database or a restore from an unverified snapshot. A restore into an existing volume may require a one-off helper container with appropriate filesystem permissions; validate the exact volume name and snapshot location first.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `ExperimentalWarning: SQLite` | Expected from Node 22; not a database failure |
| `SQLITE_CANTOPEN` or permission error | Verify `FAMILY_HQ_DB_PATH`, mounted volume, and `node` user write permissions |
| `SQLITE_BUSY` | Check for multiple writers or long transactions; busy timeout is 5 seconds |
| Missing data after recreation | Check the Compose project and actual mounted volume; never use `down -v` |
| Migration fails | Read startup logs, retain the database, reproduce against a snapshot, and fix via a new migration |
| Health endpoint works but chores are absent | The health route only proves startup; inspect the database tables separately |
