#!/usr/bin/env python3
"""Read-only Family HQ backup health check for scheduled monitoring (Python 3.9+)."""
import argparse
import datetime as dt
import json
import os
import fcntl
import subprocess
import tempfile
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



def notify(result, state_path, log_tool):
    """Emit on state transitions only; preserve old state if emission fails."""
    state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(str(state_path) + ".lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = None
        if state_path.exists():
            try:
                previous = json.loads(state_path.read_text()).get("state")
            except (OSError, ValueError, AttributeError):
                raise RuntimeError("Notification state is unreadable; refusing duplicate event")
        current = "healthy" if result["status"] == "healthy" else result.get("reason", "monitoring_failed")
        if previous == current:
            return "unchanged"
        # A healthy baseline should not create a spurious recovery notification.
        if current == "healthy" and previous is None:
            event = None
        elif current == "healthy":
            event = ("0", "[Family HQ] Backup monitoring recovered")
        else:
            event = ("2", "[Family HQ] Backup monitoring error: " + current)
        if event:
            subprocess.run([str(log_tool), "-a", event[1], "-t", event[0]],
                           check=True, timeout=15, capture_output=True)
        fd, temporary = tempfile.mkstemp(prefix=".backup-health-", dir=state_path.parent)
        try:
            with os.fdopen(fd, "w") as output:
                os.fchmod(output.fileno(), 0o600)
                json.dump({"state": current}, output)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, state_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return "notified" if event else "baseline"



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--max-age-hours", type=float, default=36)
    parser.add_argument("--min-snapshots", type=int, default=1)
    parser.add_argument("--notify-qnap", action="store_true", help="Emit QNAP events on transitions")
    parser.add_argument("--state-file", type=Path, help="Private persistent notification state file")
    parser.add_argument("--log-tool", type=Path, default=Path("/sbin/log_tool"))
    args = parser.parse_args()
    if args.notify_qnap and not args.state_file:
        parser.error("--notify-qnap requires --state-file")
    try:
        result = assess(args.root, args.max_age_hours, args.min_snapshots)
    except (OSError, ValueError) as exc:
        result = {"status": "error", "reason": "monitoring_failed", "error_type": type(exc).__name__}
    if args.notify_qnap:
        try:
            result["notification"] = notify(result, args.state_file, args.log_tool)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
            result["notification"] = "failed"
            result["notification_error"] = type(exc).__name__
    print(json.dumps({"timestamp": dt.datetime.now(dt.timezone.utc).isoformat(), **result},
                     sort_keys=True), flush=True)
    return 0 if result["status"] == "healthy" and result.get("notification") != "failed" else 1


if __name__ == "__main__":
    sys.exit(main())
