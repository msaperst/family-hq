import datetime as dt
import importlib.util
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import subprocess

ROOT = Path(__file__).resolve().parents[1] / "deployment"
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("check_backup_health", ROOT / "check_backup_health.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
from family_hq_backup import REQUIRED_TABLES

NOW = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)


def snapshot(root, hours_old=2, valid=True):
    path = root / "family-hq-20261020T000000000000Z.sqlite"
    if valid:
        with sqlite3.connect(path) as db:
            for name in REQUIRED_TABLES:
                db.execute(f"CREATE TABLE {name} (id TEXT)")
    else:
        path.write_bytes(b"not a SQLite database")
    import os
    timestamp = (NOW - dt.timedelta(hours=hours_old)).timestamp()
    os.utime(path, (timestamp, timestamp))
    return path


class BackupHealthTests(unittest.TestCase):
    def test_missing_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            result = monitor.assess(Path(temp) / "missing", now=NOW)
            self.assertEqual(result["reason"], "backup_directory_missing")

    def test_empty_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            result = monitor.assess(Path(temp), now=NOW)
            self.assertEqual(result["reason"], "insufficient_snapshots")

    def test_healthy_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            snapshot(Path(temp))
            result = monitor.assess(Path(temp), now=NOW)
            self.assertEqual(result["status"], "healthy")
            self.assertEqual(result["snapshot_count"], 1)
            self.assertEqual(result["age_hours"], 2)

    def test_stale_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            snapshot(Path(temp), hours_old=40)
            self.assertEqual(monitor.assess(Path(temp), now=NOW)["reason"], "stale_snapshot")

    def test_corrupt_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            snapshot(Path(temp), valid=False)
            self.assertEqual(monitor.assess(Path(temp), now=NOW)["reason"], "invalid_snapshot")

    def test_future_and_minimum_count(self):
        with tempfile.TemporaryDirectory() as temp:
            snapshot(Path(temp), hours_old=-3)
            self.assertEqual(monitor.assess(Path(temp), now=NOW)["reason"], "future_snapshot_timestamp")
            self.assertEqual(monitor.assess(Path(temp), min_snapshots=2, now=NOW)["reason"], "insufficient_snapshots")

    def test_symlink_not_considered_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            destination = root / "other.sqlite"
            destination.write_bytes(b"not sqlite")
            (root / "family-hq-20261020T000000000000Z.sqlite").symlink_to(destination)
            self.assertEqual(monitor.assess(root, now=NOW)["reason"], "insufficient_snapshots")


    def test_qnap_initial_healthy_is_silent_then_failure_and_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp) / "state.json"
            healthy = {"status": "healthy"}
            failed = {"status": "error", "reason": "stale_snapshot"}
            with patch.object(monitor.subprocess, "run") as send:
                self.assertEqual(monitor.notify(healthy, state, Path("/sbin/log_tool")), "baseline")
                send.assert_not_called()
                self.assertEqual(monitor.notify(failed, state, Path("/sbin/log_tool")), "notified")
                self.assertEqual(monitor.notify(failed, state, Path("/sbin/log_tool")), "unchanged")
                self.assertEqual(monitor.notify(healthy, state, Path("/sbin/log_tool")), "notified")
                self.assertEqual(send.call_count, 2)
                self.assertEqual(send.call_args.args[0][-1], "0")

    def test_failed_event_keeps_old_state_for_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp) / "state.json"
            with patch.object(monitor.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "log_tool")):
                with self.assertRaises(subprocess.CalledProcessError):
                    monitor.notify({"status": "error", "reason": "invalid_snapshot"},
                                   state, Path("/sbin/log_tool"))
            self.assertFalse(state.exists())

    def test_corrupt_state_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp) / "state.json"
            state.write_text("not JSON")
            with patch.object(monitor.subprocess, "run") as send:
                with self.assertRaises(RuntimeError):
                    monitor.notify({"status": "error", "reason": "stale_snapshot"},
                                   state, Path("/sbin/log_tool"))
                send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
