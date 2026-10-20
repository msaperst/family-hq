#!/usr/bin/env python3
"""Read-only Family HQ backup health check for scheduled monitoring (Python 3.9+)."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sys

from family_hq_backup import check_database


def assess(root, max_age_hours=36, min_snapshots=1, now=None):
    """Check that a recent, consistent snapshot exists; never modify the backup directory."""
    if max_age_hours <= 0 or min_snapshots < 1:
        raise ValueError("Invalid backup monitoring thresholds")
    now = now or dt.datetime.now(dt.timezone.utc)
    if not root.is_dir():
        return {"status": "error", "reason": "backup_directory_missing", "snapshot_count": 0}
    snapshots = sorted(
        (item for item in root.glob("family-hq-*.sqlite")
         if item.is_file() and not item.is_symlink()),
        key=lambda item: item.stat().st_mtime, reverse=True,
    )
    count = len(snapshots)
    if count < min_snapshots:
        return {"status": "error", "reason": "insufficient_snapshots",
                "snapshot_count": count}
    latest = snapshots[0]
    age = (now - dt.datetime.fromtimestamp(latest.stat().st_mtime, dt.timezone.utc)).total_seconds() / 3600
    if age < -1:
        return {"status": "error", "reason": "future_snapshot_timestamp",
                "snapshot_count": count, "latest": latest.name}
    if age > max_age_hours:
        return {"status": "error", "reason": "stale_snapshot",
                "snapshot_count": count, "latest": latest.name, "age_hours": round(age, 2)}
    try:
        check_database(latest)
    except Exception:
        # Do not expose paths or database contents in logs.
        return {"status": "error", "reason": "invalid_snapshot",
                "snapshot_count": count, "latest": latest.name}
    return {"status": "healthy", "snapshot_count": count,
            "latest": latest.name, "age_hours": round(age, 2)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--max-age-hours", type=float, default=36)
    parser.add_argument("--min-snapshots", type=int, default=1)
    args = parser.parse_args()
    try:
        result = assess(args.root, args.max_age_hours, args.min_snapshots)
    except (OSError, ValueError) as exc:
        result = {"status": "error", "reason": "monitoring_failed", "error_type": type(exc).__name__}
    print(json.dumps({"timestamp": dt.datetime.now(dt.timezone.utc).isoformat(), **result},
                     sort_keys=True), flush=True)
    return 0 if result["status"] == "healthy" else 1


if __name__ == "__main__":
    sys.exit(main())
