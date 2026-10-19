import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1] / "deployment"
sys.path.insert(0, str(DEPLOY))
spec = importlib.util.spec_from_file_location("prepare_deployment_experiment", DEPLOY / "prepare_deployment_experiment.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
OLD = "a" * 40
NEW = "b" * 40

class PreparationTests(unittest.TestCase):
    def test_creates_staged_files_and_never_runs_compose_up(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "app"
            app.mkdir()
            original = app / "docker-compose.yml"
            original.write_text(f"services:\n  family-hq:\n    image: ghcr.io/msaperst/family-hq:sha-{OLD}\n")
            resource = app / "docker-compose.resource.yml"
            resource.write_text("services:\n  family-hq:\n    mem_limit: 0\n")
            db = root / "data"
            db.mkdir()
            (db / "family-hq.sqlite").write_bytes(b"placeholder")
            backup_root = root / "backups"
            backup_root.mkdir()
            script = root / "backup.py"
            script.write_text("placeholder")
            calls = []
            def fake_run(argv):
                calls.append(argv)
                if argv[1:3] == ["volume", "inspect"]:
                    return str(db)
                if "backup" in argv:
                    (backup_root / "family-hq-test.sqlite").write_bytes(b"snapshot")
                return ""
            with patch.object(p, "preflight", return_value={"current_revision": OLD}), \
                 patch.object(p, "inspect_container", return_value=({}, OLD)), \
                 patch.object(p, "run", side_effect=fake_run):
                result = p.prepare_experiment("docker", "python3", original, resource, NEW, script, backup_root, root / "experiment")
            self.assertEqual(original.read_text().count(OLD), 1)
            self.assertIn(NEW, (root / "experiment" / "candidate.yml").read_text())
            self.assertIn(OLD, (root / "experiment" / "baseline.yml").read_text())
            self.assertFalse(result["deployment_performed"])
            self.assertFalse(any("up" in argv or "down" in argv or "pull" in argv for argv in calls))

    def test_refuses_missing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(p, "preflight", return_value={"current_revision": OLD}), \
                 patch.object(p, "inspect_container", return_value=({}, OLD)), \
                 patch.object(p, "run", return_value=str(root)):
                with self.assertRaisesRegex(p.PreflightError, "missing"):
                    p.prepare_experiment("docker", "python3", root/"compose", root/"resource", NEW, root/"backup", root/"out", root/"staging")

if __name__ == "__main__":
    unittest.main()
