# Family HQ: NAS-local SQLite backup and restore

This is intentionally a **local recovery point**, not an offsite or 3-2-1 backup. It does not alter the existing QNAP/S3 backup system. The live database is in the external Docker volume `family-hq-data`; backup snapshots live in the private directory supplied using `--root`. Keep this directory private.

## Install once on the NAS

Download this script from the reviewed, merged release (or a pinned commit), not an arbitrary floating branch, then run:

```sh
sudo mkdir -p /path/to/private/family-hq-backups
sudo chmod 700 /path/to/private/family-hq-backups
sudo chmod 755 /path/to/family-hq-deployment/family_hq_backup.py

# Retrieve actual Docker-managed volume mountpoint rather than guessing QNAP internals:
docker volume inspect family-hq-data --format '{{.Mountpoint}}'
```

Use the resulting mountpoint plus `/family-hq.sqlite` as the `--db` argument below. Execute through `sudo python3` so the SQLite file and private destination are accessible; Python 3 on the NAS has sqlite3 built in.

## Backup and verification

```sh
DB="$(docker volume inspect family-hq-data --format '{{.Mountpoint}}')/family-hq.sqlite"
sudo python3 /path/to/family-hq-deployment/family_hq_backup.py backup --db "$DB" --root /path/to/private/family-hq-backups
# To independently validate a selected snapshot:
sudo python3 /path/to/family-hq-deployment/family_hq_backup.py verify --db "$DB" --root /path/to/private/family-hq-backups --snapshot /path/to/private/family-hq-backups/family-hq-YYYYMMDDTHHMMSSffffffZ.sqlite
```

Backup uses Python sqlite3's online backup API, not `cp`, so committed WAL transactions are included. It writes to a temporary file, validates SQLite integrity and Family HQ tables, atomically publishes the result, then prunes older files. Retention defaults to the latest **30 successful snapshots** (not 30 calendar days). Jobs use an advisory `flock`; errors exit nonzero. Keep snapshots on the NAS; no S3 synchronization is configured.

## Persistent QNAP cron

Create a root-owned wrapper on the NAS, for example `/path/to/family-hq-deployment/run-backup.sh`:

```sh
#!/bin/sh
set -eu
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
DB="$(docker volume inspect family-hq-data --format '{{.Mountpoint}}')/family-hq.sqlite"
exec /usr/bin/python3 /path/to/family-hq-deployment/family_hq_backup.py backup --db "$DB" --root /path/to/private/family-hq-backups
```

**QNAP Container Station:** Docker may not be on the default cron or sudo PATH. Check `command -v docker` interactively, and prepend the directory containing its binary to the wrapper PATH. For example, if Docker is at `/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker`, use `export PATH="/share/CACHEDEV1_DATA/.qpkg/container-station/bin:$PATH"` after the standard PATH line. Check `command -v python3` and update the wrapper path to the actual executable. Protect the wrapper from untrusted edits. Schedule a daily run in **`/etc/config/crontab`** (QNAP's persistent crontab), e.g.:

```cron
45 2 * * * /path/to/family-hq-deployment/run-backup.sh >> /path/to/private/family-hq-backups/backup.log 2>&1
```

Reload with `sudo /etc/init.d/crond.sh reload`, verify both `/etc/config/crontab` and `/tmp/cron/crontabs/admin`, and check the next successful log and snapshot. QNAP has previously run stale/duplicate cron schedules, so verify rather than blindly appending duplicate entries.

## Restore drill / recovery

**Restores require downtime.** First verify your selected snapshot; only then stop the exact Family HQ container. Do not stop other apps or any Minecraft containers. Keep the QNAP Container Station application definition and its external volume in place.

```sh
DB="$(docker volume inspect family-hq-data --format '{{.Mountpoint}}')/family-hq.sqlite"
SNAPSHOT="/path/to/private/family-hq-backups/family-hq-YYYYMMDDTHHMMSSffffffZ.sqlite"
sudo python3 /path/to/family-hq-deployment/family_hq_backup.py verify --db "$DB" --root /path/to/private/family-hq-backups --snapshot "$SNAPSHOT"

docker stop family-hq-family-hq-1
# Confirm it is stopped BEFORE continuing, and WAL/SHM are not left behind.
docker inspect -f '{{.State.Running}}' family-hq-family-hq-1
sudo ls -l "${DB}-wal" "${DB}-shm" 2>/dev/null || true

# Only if the container is stopped and the WAL/SHM files are absent:
sudo python3 /path/to/family-hq-deployment/family_hq_backup.py restore --db "$DB" --root /path/to/private/family-hq-backups --snapshot "$SNAPSHOT" --confirm

docker start family-hq-family-hq-1
docker inspect -f '{{.State.Health.Status}}' family-hq-family-hq-1
curl -fsS http://127.0.0.1:3080/api/health
```

The utility first takes a **pre-restore rescue snapshot** of the stopped live database, then stages and verifies the requested snapshot before atomically replacing the main DB file while preserving file owner/mode. It refuses a restore if WAL/SHM files exist. If those files remain after stopping, **do not delete them blindly**; investigate/checkpoint properly first. It also refuses backups outside the configured snapshot directory. Restore is intentionally operator-controlled rather than automatic.

For a production restore drill, create a test child/chore record, back up, change the record, restore the selected backup, and verify the prior state returns. Save the test evidence before closing issue #3. Always confirm the app's health after restart.

## Test locally

```sh
python3 -m unittest discover -s tests -p 'test_family_hq_backup.py' -v
```

## Limitations

Local snapshots share the NAS failure domain; RAID loss, filesystem failure, or theft can destroy both copies. Container image rollback does **not** automatically imply compatible SQLite schema rollback. Record the deployed image SHA alongside recovery decisions. Backups are not automatically sent to AWS, `/share/Public`, or Grafana.
