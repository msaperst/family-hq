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

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `docker: command not found` | Container Station's Docker directory must be included in the wrapper PATH. |
| `python3: not found` | Use the absolute path reported by `command -v python3`. |
| Permission denied | Check the user running the job, Docker volume ownership, script permissions, and private backup directory permissions. |
| Database locked | Ensure no restore is attempted while Family HQ is running; investigate other open SQLite connections. |
| WAL/SHM files present | Do not force replacement. Confirm the service is stopped and investigate a safe checkpoint. |
| No scheduled snapshot | Check the persistent and active QNAP crontabs, executable paths, and backup log. |

## Testing

Run the unit tests from the repository root:

```sh
python3 -m unittest discover -s tests -p 'test_family_hq_backup.py' -v
```

These tests cover snapshot consistency, integrity validation, retention, and restore behavior. They do not replace a restore drill against the real NAS deployment.
