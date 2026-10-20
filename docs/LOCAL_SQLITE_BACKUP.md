# Local SQLite Backup and Restore

Family HQ stores its data in a SQLite database in the external Docker volume `family-hq-data`. This guide describes local snapshots on a QNAP NAS and recovery from those snapshots.

Backups are stored in a private NAS directory outside the application volume. They protect against accidental changes and failed updates, but **not failure or loss of the NAS itself**. No remote backup is configured.

## Prerequisites

The NAS needs Docker (Container Station), Python 3 with the built-in `sqlite3` module, and permission to read/write the application database and the backup directory.

Find the executable locations before configuring a scheduled task:

```sh
command -v docker
command -v python3
docker volume inspect family-hq-data --format '{{.Mountpoint}}'
```

On QNAP, Docker and Python may be installed outside the standard shell or cron PATH. Use the executable paths reported by **your** NAS in the wrapper below. Keep the backup utility at a stable location and restrict who can edit it.

## Configure the backup

Choose a private directory for snapshots and a directory for the backup utility. Substitute those locations in the following commands:

```sh
BACKUP_DIR=/path/to/private/family-hq-backups
SCRIPT=/path/to/family-hq-deployment/family_hq_backup.py
DB="$(docker volume inspect family-hq-data --format '{{.Mountpoint}}')/family-hq.sqlite"

sudo mkdir -p "$BACKUP_DIR"
sudo chmod 700 "$BACKUP_DIR"
test -f "$SCRIPT"
test -f "$DB"
```

The backup script accepts an explicit `--root` destination; it never assumes a particular NAS share. The scheduled wrapper must use absolute executable paths because cron may have a restricted PATH.

## Create and verify a backup

The application can remain running while a backup is created:

```sh
sudo "$(command -v python3)" "$SCRIPT" backup --db "$DB" --root "$BACKUP_DIR"
```

A successful run reports `BACKUP_OK` and the snapshot filename. To verify one:

```sh
SNAPSHOT=/path/to/private/family-hq-backups/family-hq-YYYYMMDDTHHMMSSffffffZ.sqlite
sudo "$(command -v python3)" "$SCRIPT" verify --db "$DB" --root "$BACKUP_DIR" --snapshot "$SNAPSHOT"
```

A valid snapshot reports `VERIFY_OK`. The utility uses SQLite's online backup API, so committed transactions in WAL mode are included; copying the live `.sqlite` file directly is not equivalent. Each snapshot is integrity-checked and atomically published before older backups are pruned.

By default, retention keeps the **30 newest successful snapshots**, rather than 30 calendar days. Failed backups return a nonzero exit code. A lock prevents simultaneous backup and restore invocations through the utility.

## Schedule daily backups

Create a wrapper script at a stable location on the NAS, for example `/path/to/family-hq-deployment/run-backup.sh`:

```sh
#!/bin/sh
set -eu

# Update these paths to match the NAS.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# Set absolute executable paths based on command -v docker / python3.
DOCKER=/path/to/docker
PYTHON=/path/to/python3
SCRIPT=/path/to/family-hq-deployment/family_hq_backup.py
BACKUP_DIR=/path/to/private/family-hq-backups

DB="$("$DOCKER" volume inspect family-hq-data --format '{{.Mountpoint}}')/family-hq.sqlite"
exec "$PYTHON" "$SCRIPT" backup --db "$DB" --root "$BACKUP_DIR"
```

Make the wrapper executable and test **before scheduling it**:

```sh
chmod 755 /path/to/family-hq-deployment/run-backup.sh
sudo /path/to/family-hq-deployment/run-backup.sh
```

Check for `BACKUP_OK` and a new snapshot. Run the scheduled task with sufficient permissions to read the Docker volume and write the backup directory. Do not make the backup directory world-writable.

QNAP keeps persistent cron entries in `/etc/config/crontab`. Add one daily entry, adjusting paths as needed:

```cron
45 2 * * * /path/to/family-hq-deployment/run-backup.sh >> /path/to/private/family-hq-backups/backup.log 2>&1
```

After saving the file, reload cron:

```sh
sudo /etc/init.d/crond.sh reload
```

Verify the entry in `/etc/config/crontab` and the active `/tmp/cron/crontabs/admin`, then inspect the log and snapshots after the next scheduled run. Avoid duplicate cron entries.

## Restore a snapshot

**Restoration overwrites the current application database and requires downtime.** Choose a verified snapshot and make sure you know which application container owns the database.

1. Verify the selected snapshot using the `verify` command above.
2. Stop the Family HQ application container and confirm it is stopped.
3. Check for `family-hq.sqlite-wal` and `family-hq.sqlite-shm` next to the database. The restore utility refuses to proceed while either exists. Do not delete these files blindly; investigate/checkpoint first.
4. Run the restore operation, then start Family HQ and confirm its health and data.

Example, substituting the actual container name and paths:

```sh
CONTAINER=family-hq-family-hq-1
docker stop "$CONTAINER"
test "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = false

# Stop here if either file is present.
sudo ls -l "${DB}-wal" "${DB}-shm" 2>/dev/null || true

# Only continue when the container is stopped and both files are absent.
sudo "$(command -v python3)" "$SCRIPT" restore --db "$DB" --root "$BACKUP_DIR" --snapshot "$SNAPSHOT" --confirm

docker start "$CONTAINER"
curl -fsS http://127.0.0.1:3080/api/health
```

Before replacing the database, the utility creates a pre-restore rescue snapshot in the backup directory. It validates the selected snapshot and the staged replacement, then preserves the database file's ownership and permissions during replacement. **The `--confirm` flag does not stop the container for you.**

For a recovery drill, create a disposable child or chore record, take a snapshot, change the record, restore the snapshot, and confirm the previous state returns. Verify application health and normal functionality after restart. Keep the external volume and Container Station application definition intact.

## Monitor scheduled backup health

The read-only `deployment/check_backup_health.py` checks whether the backup directory contains a recent SQLite snapshot with a valid schema and integrity check. It returns structured JSON and exits nonzero on failures. It does not create/prune backups or modify the application.

Run it with Python 3.9+ and the same private backup directory configured for scheduled snapshots:

```sh
python3 /path/to/deployment/check_backup_health.py --root /path/to/private/family-hq-backups --max-age-hours 36
```

The default freshness threshold is **36 hours**, allowing for a daily backup schedule with some delay. A successful response has `"status":"healthy"`; failure includes a machine-readable reason such as `stale_snapshot`, `backup_directory_missing`, `insufficient_snapshots`, or `invalid_snapshot`. The monitor checks the newest file by modification time. A fresh manually generated snapshot can satisfy this check even if the daily cron task fails, so also periodically review the scheduled backup log and cron registration.

For unattended checks, add a **separate** daily cron task after the backup's expected completion window, with output redirected to a private log. Example only:

```cron
30 4 * * * /absolute/path/to/python3 /absolute/path/to/deployment/check_backup_health.py --root /path/to/private/family-hq-backups >> /path/to/private/backup-health.log 2>&1
```

**A failing cron exit code does not automatically notify anyone on QNAP.** Configure a monitored alert destination (such as NAS notifications, an existing monitoring system, or a private webhook) separately; do not treat log files as notifications. Avoid sending snapshot paths, database content, OAuth credentials, or other household data to an external alert service. The check is local-only and does not change existing S3/NAS backup jobs.

### Optional QNAP notification-bell events

On QTS 5.2.10, the NAS `/sbin/log_tool -a MESSAGE -t 2` command has been verified to create an Error event in QuLog Center **and** the QTS notification bell without any Notification Center delivery rule. To enable transition-based local alerts, use a persistent, private state file **outside the backup folder's snapshot files**:

```sh
python3 /path/to/deployment/check_backup_health.py \
  --root /path/to/private/family-hq-backups \
  --notify-qnap \
  --state-file /path/to/private/family-hq-monitor/notification-state.json
```

Run this as an account allowed to execute `/sbin/log_tool` and write the state directory. On the first healthy check, only the baseline is saved; on the first unhealthy check, one QNAP Error event is emitted. Repeated checks with the same failure do not repeat alerts. A changed failure emits another Error event; recovery emits an Information event. State changes are atomic and locked between concurrent invocations. If event delivery fails, the previous state remains so the next check retries. **A monitoring cron entry does not install itself**; schedule this after your backup job and confirm it appears in the QNAP bell. Email and Qmanager push are intentionally not configured.

The snapshot monitor still prints JSON suitable for local monitoring/Grafana ingestion. Its nonzero exit on an unhealthy backup or notification command failure should also be tracked in the job log. Do not put sensitive household data in event messages.

### Production QNAP monitoring runbook (validated on QTS 5.2.10)

The working deployment uses **two separate schedules**: daily SQLite backup at **02:45 NAS-local time**, and daily health monitoring at **04:00 NAS-local time**. The deployment updater also creates verified snapshots before image updates. Monitoring scans the common private snapshot directory (so a recent deployment snapshot can satisfy freshness even if the daily backup job missed a run).

Keep actual directories and hostnames in private NAS configuration, not public committed scripts. The following variables are placeholders:

```sh
BACKUP_DIR=/path/to/private/family-hq-backups
MONITOR=/path/to/deployment/check_backup_health.py
STATE_DIR=/path/to/private/family-hq-monitor
PYTHON=/absolute/path/to/python3

sudo mkdir -p "$STATE_DIR"
sudo chmod 700 "$STATE_DIR"

# This initial healthy run establishes a silent notification baseline.
sudo "$PYTHON" "$MONITOR" \
  --root "$BACKUP_DIR" \
  --max-age-hours 36 \
  --notify-qnap \
  --state-file "$STATE_DIR/state.json"
```

Use a privileged account for this check when snapshot files are mode `0600` and owned by the NAS administrator. A nonprivileged check may report `invalid_snapshot` because it cannot open the SQLite file; **do not loosen backup permissions**. Confirm the result using the existing backup utility's `verify` action or by rerunning the check with the correct permissions before treating a snapshot as corrupt.

For scheduling, first confirm `command -v python3` returns the actual absolute interpreter path. After backing up `/etc/config/crontab`, add **one** monitoring entry (substituting the private paths):

```cron
0 4 * * * /absolute/path/to/python3 /path/to/deployment/check_backup_health.py --root /path/to/private/family-hq-backups --max-age-hours 36 --notify-qnap --state-file /path/to/private/family-hq-monitor/state.json >> /path/to/private/family-hq-monitor.log 2>&1
```

QNAP persists cron in `/etc/config/crontab`. Reload using `sudo /etc/init.d/crond.sh reload`; verify the line is present both in the persistent file and in `/tmp/cron/crontabs/admin`. Confirm the job runs with privileges adequate to read the snapshots and write state, that the JSON log says `healthy`, and that the next day's snapshot is recent.

**End-to-end acceptance test performed on QTS 5.2.10:**

1. Run the monitor on an **empty disposable directory**, with a disposable notification state file and `--notify-qnap`. Expect `status=error`, `reason=insufficient_snapshots`, `notification=notified` and one QNAP error-bell entry.
2. Repeat the same check: expect `notification=unchanged` and **no new error entry**.
3. Point the same disposable state file at the real snapshot directory, using appropriate privileges: expect `status=healthy`, `notification=notified`, and a recovery **Information** event in QuLog Center.
4. Run the actual production monitor with its **separate** permanent state file; a first healthy run produces `notification=baseline` and no extra bell alert.

QuLog Center visibly received the error and recovery records; the error also appeared in QTS's built-in notification bell. **Recovery is Information severity and might appear in QuLog without appearing in the error-focused bell view.** No Notification Center email/push rules or Grafana ingestion were configured by this work.

**Operational caveats:** The monitor checks snapshot freshness, SQLite integrity and expected schema, not NAS offsite disaster recovery, actual daily-job completion, or guaranteed delivery of a bell alert when the entire NAS is offline. Snapshot retention remains 30 successful backups; no existing NAS/S3 jobs or backup paths were altered. Maintain a periodic restore drill independently. For a permission-related `invalid_snapshot`, confirm readable-file access before changing code or removing backups.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `docker: command not found` | Container Station's Docker directory must be included in the wrapper PATH. |
| `python3: not found` | Use the absolute path reported by `command -v python3`. |
| Permission denied | Check the user running the job, Docker volume ownership, script permissions, and private backup directory permissions. |
| Database locked | Ensure no restore is attempted while Family HQ is running; investigate other open SQLite connections. |
| WAL/SHM files present | Do not force replacement. Confirm the service is stopped and investigate a safe checkpoint. |
| No scheduled snapshot | Check the persistent and active QNAP crontabs, executable paths, and backup log. |
| Monitor reports `invalid_snapshot` but backups verify as admin | Rerun the monitor as the backup-owning privileged account; mode `0600` snapshots cannot be read by other users. |
| No new notification despite a continuing failure | Check JSON `notification=unchanged` and the persisted state; repeated identical errors are deliberately deduplicated. |
| QNAP recovery absent from error bell | The recovery event uses Information severity; inspect QuLog Center's Event Log. |

## Testing

Run the unit tests from the repository root:

```sh
python3 -m unittest discover -s tests -p 'test_family_hq_backup.py' -v
```

These tests cover snapshot consistency, integrity validation, retention, and restore behavior. They do not replace a restore drill against the real NAS deployment.
