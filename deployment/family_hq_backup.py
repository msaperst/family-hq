#!/usr/bin/env python3
"""NAS-local, consistent SQLite backup/restore for Family HQ (Python 3.9+)."""
import argparse
import datetime as dt
import fcntl
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

DB_NAME = "family-hq.sqlite"
REQUIRED_TABLES = {"children", "chores", "chore_schedules", "chore_completions", "schema_migrations"}
DEFAULT_ROOT = Path("/share/homes/msaperst/family-hq-backups")


def check_database(path):
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        result = db.execute("PRAGMA integrity_check").fetchone()
        if result != ("ok",):
            raise RuntimeError(f"SQLite integrity check failed: {result}")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        missing = REQUIRED_TABLES - tables
        if missing:
            raise RuntimeError(f"Missing Family HQ tables: {sorted(missing)}")


def backup(source, root, retain=30):
    source = Path(source)
    root = Path(root)
    if not source.is_file():
        raise FileNotFoundError(source)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = root / f"family-hq-{timestamp}.sqlite"
    fd, temporary = tempfile.mkstemp(prefix=".family-hq-", suffix=".sqlite", dir=root)
    os.close(fd)
    try:
        with sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=30) as live:
            with sqlite3.connect(temporary) as snapshot:
                live.backup(snapshot)
        check_database(temporary)
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
        # Only prune after a validated snapshot is safely in place.
        old = sorted(root.glob("family-hq-????????T??????????????Z.sqlite"), reverse=True)
        for item in old[retain:]:
            item.unlink()
        print(f"BACKUP_OK {target} bytes={target.stat().st_size}", flush=True)
        return target
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restore(snapshot, source, root, confirmed=False):
    if not confirmed:
        raise RuntimeError("Restore requires --confirm; stop the Family HQ container first")
    snapshot = Path(snapshot).resolve(strict=True)
    source = Path(source)
    root = Path(root)
    # Reject external paths, and symlink-based escapes.
    if not snapshot.is_relative_to(root.resolve(strict=True)):
        raise RuntimeError("Restore source must be within the backup directory")
    check_database(snapshot)
    if not source.is_file():
        raise RuntimeError("Live database not found; refusing restore")
    # Preserve the current state while the application is stopped.
    rescue = backup(source, root, retain=30)
    staged = source.with_name(f".family-hq-restore-{os.getpid()}.sqlite")
    try:
        shutil.copyfile(snapshot, staged)
        check_database(staged)
        stat = source.stat()
        os.chmod(staged, stat.st_mode & 0o777)
        os.chown(staged, stat.st_uid, stat.st_gid)
        # WAL and SHM are managed by the application; do not restore over them.
        for suffix in ("-wal", "-shm"):
            if Path(str(source) + suffix).exists():
                raise RuntimeError("WAL/SHM files exist: verify application is stopped and checkpointed; restore aborted")
        os.replace(staged, source)
        print(f"RESTORE_OK from={snapshot} pre_restore_backup={rescue}", flush=True)
    finally:
        if staged.exists():
            staged.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "verify", "restore"])
    parser.add_argument("--db", type=Path, required=True, help="Resolved Docker-volume SQLite path")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="Private local backup folder")
    parser.add_argument("--snapshot", type=Path, help="Existing backup for verify/restore")
    parser.add_argument("--confirm", action="store_true", help="Acknowledge the container was stopped")
    parser.add_argument("--retain", type=int, default=30)
    args = parser.parse_args()
    if args.retain < 2:
        parser.error("--retain must be at least 2")
    if args.action in ("verify", "restore") and not args.snapshot:
        parser.error("--snapshot is required")
    args.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Stable lockfile must never be removed: removing it creates lock races.
    lock = args.root / ".backup.lock"
    try:
        with open(lock, "a+") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Another Family HQ backup/restore is running")
            if args.action == "backup":
                backup(args.db, args.root, args.retain)
            elif args.action == "verify":
                check_database(args.snapshot)
                print(f"VERIFY_OK {args.snapshot}")
            else:
                restore(args.snapshot, args.db, args.root, args.confirm)
    except (OSError, sqlite3.Error, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
