import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "deployment" / "family_hq_backup.py"
spec = importlib.util.spec_from_file_location("family_hq_backup", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.db_path = self.base / "live.sqlite"
        self.root = self.base / "backups"
        with sqlite3.connect(self.db_path) as db:
            db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE children (id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE chores (id TEXT PRIMARY KEY);
            CREATE TABLE chore_schedules (id TEXT PRIMARY KEY);
            CREATE TABLE chore_completions (id TEXT PRIMARY KEY);
            CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
            INSERT INTO children VALUES ('a', 'Alex');
            """)

    def test_snapshot_captures_wal_and_restore(self):
        live = sqlite3.connect(self.db_path)
        live.execute("PRAGMA journal_mode=WAL")
        live.execute("INSERT INTO children VALUES ('b','Blair')")
        live.commit()
        snapshot = module.backup(self.db_path, self.root)
        with sqlite3.connect(snapshot) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM children").fetchone()[0], 2)
        live.close()
        with sqlite3.connect(self.db_path) as db:
            db.execute("DELETE FROM children")
        # Ensure the database is cleanly closed and its WAL files are absent.
        for suffix in ("-wal", "-shm"):
            self.assertFalse(Path(str(self.db_path) + suffix).exists())
        module.restore(snapshot, self.db_path, self.root, confirmed=True)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM children").fetchone()[0], 2)
        self.assertEqual(len(list(self.root.glob("family-hq-*.sqlite"))), 2)

    def test_validation_rejects_corrupt_snapshot(self):
        snapshot = self.root / "broken.sqlite"
        self.root.mkdir()
        snapshot.write_bytes(b"not a database")
        with self.assertRaises(sqlite3.DatabaseError):
            module.check_database(snapshot)

    def test_no_unconfirmed_restore(self):
        snapshot = module.backup(self.db_path, self.root)
        with self.assertRaisesRegex(RuntimeError, "confirm"):
            module.restore(snapshot, self.db_path, self.root)

    def test_retention(self):
        for _ in range(5):
            module.backup(self.db_path, self.root, retain=2)
        self.assertEqual(len(list(self.root.glob("family-hq-*.sqlite"))), 2)

    def test_rejects_external_snapshot(self):
        snapshot = module.backup(self.db_path, self.root)
        outside = self.base / "outside.sqlite"
        outside.write_bytes(snapshot.read_bytes())
        with self.assertRaisesRegex(RuntimeError, "within the backup directory"):
            module.restore(outside, self.db_path, self.root, confirmed=True)

    def test_missing_source_does_not_create_empty_backup(self):
        with self.assertRaises(FileNotFoundError):
            module.backup(self.base / "missing.sqlite", self.root)


if __name__ == "__main__":
    unittest.main()
