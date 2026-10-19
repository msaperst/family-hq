import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1] / "deployment"
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("deploy_cli", ROOT / "deploy_cli.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
OLD = "a"*40
NEW = "b"*40
MANIFEST = f"services:\n  family-hq:\n    image: ghcr.io/msaperst/family-hq:sha-{OLD}\n    restart: unless-stopped\n"

class CliDeployTests(unittest.TestCase):
    def test_stage_only_changes_image(self):
        staged = d.stage(MANIFEST, NEW)
        self.assertIn("sha-" + NEW, staged)
        self.assertIn("restart: unless-stopped", staged)
        self.assertNotIn(OLD, staged)

    def test_refuses_ambiguous_images(self):
        with self.assertRaises(d.PreflightError):
            d.stage(MANIFEST + MANIFEST, NEW)

    def test_dry_run_does_not_call_docker_or_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            compose=base/"original.yml"
            resource=base/"resource.yml"
            compose.write_text(MANIFEST)
            resource.write_text("services: {}\n")
            args=SimpleNamespace(docker="docker",python="python3",compose=compose,
                resource=resource,state_dir=base/"state",backup_dir=base/"backups",
                backup_script=base/"family_hq_backup.py",target_sha=NEW)
            with patch.object(d,"revision",return_value=OLD), \
                 patch.object(d,"published_release",return_value=NEW), \
                 patch.object(d,"run",side_effect=AssertionError("unexpected external command")):
                out=d.deploy(args,False)
            self.assertEqual(out["status"], "ready")
            self.assertFalse(out["deployment_performed"])
            self.assertEqual(compose.read_text(),MANIFEST)
            self.assertFalse((base/"state"/"active.compose.yml").exists())

    def test_refuses_unverified_candidate(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            args=SimpleNamespace(docker="docker",state_dir=base/"state",target_sha=NEW)
            with patch.object(d,"revision",return_value=OLD), \
                 patch.object(d,"published_release",return_value=OLD):
                with self.assertRaisesRegex(d.PreflightError,"verified"):
                    d.deploy(args,False)

    def test_rejects_template_divergence(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            compose=base/"original.yml"
            resource=base/"resource.yml"
            state=base/"state"
            state.mkdir()
            compose.write_text(MANIFEST)
            resource.write_text("services: {}\n")
            (state/"active.compose.yml").write_text(MANIFEST.replace("unless-stopped","always"))
            args=SimpleNamespace(docker="docker",python="python3",compose=compose,resource=resource,
                state_dir=state,backup_dir=base/"backups",backup_script=base/"backup",target_sha=NEW)
            with patch.object(d,"revision",return_value=OLD),patch.object(d,"published_release",return_value=NEW):
                with self.assertRaisesRegex(d.PreflightError,"diverged"):
                    d.deploy(args,False)

if __name__ == "__main__":
    unittest.main()
