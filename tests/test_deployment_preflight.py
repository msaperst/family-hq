import importlib.util
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
import tempfile

PATH = Path(__file__).resolve().parents[1] / "deployment" / "deployment_preflight.py"
import sys
sys.path.insert(0, str(PATH.parent))
spec = importlib.util.spec_from_file_location("deployment_preflight", PATH)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

OLD = "a" * 40
NEW = "b" * 40
YAML = f"""services:
  family-hq:
    image: ghcr.io/msaperst/family-hq:sha-{OLD}
    ports:
      - "127.0.0.1:3080:3080"
"""

class DeploymentPreflightTests(TestCase):
    def test_image_only_change(self):
        result = p.prepare(YAML, OLD, NEW)
        self.assertEqual(result.count("ghcr.io/msaperst/family-hq:sha-" + NEW), 1)
        self.assertIn('127.0.0.1:3080:3080', result)
        self.assertEqual(YAML.count(OLD), 1)

    def test_refuses_mismatched_image(self):
        with self.assertRaisesRegex(p.PreflightError, "disagrees"):
            p.prepare(YAML, NEW, OLD)

    def test_refuses_ambiguous_image_lines(self):
        with self.assertRaisesRegex(p.PreflightError, "exactly one"):
            p.prepare(YAML + "    image: something-else\n", OLD, NEW)

    def test_preflight_does_not_modify_managed_files(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            compose = home / "docker-compose.yml"
            resource = home / "docker-compose.resource.yml"
            compose.write_text(YAML)
            resource.write_text("services:\n  family-hq:\n    mem_limit: 0\n")
            info = {
                "Config": {"Labels": {
                    "com.docker.compose.project.config_files": f"{compose},{resource}"
                }}
            }
            calls = []
            def fake_command(args):
                calls.append(args)
                self.assertEqual(args[-2:], ["config", "--quiet"])
                self.assertNotIn("up", args)
                self.assertNotIn("pull", args)
                return ""
            with patch.object(p, "inspect_container", return_value=(info, OLD)), \
                 patch.object(p, "published_release", return_value=NEW), \
                 patch.object(p, "command", side_effect=fake_command):
                result = p.preflight("/path/to/docker", compose, resource, NEW)
            self.assertEqual(compose.read_text(), YAML)
            self.assertEqual(resource.read_text(), "services:\n  family-hq:\n    mem_limit: 0\n")
            self.assertEqual(len(calls), 1)
            self.assertFalse(result["deployment_performed"])

    def test_accepts_alias_paths_to_same_files(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            real = home / "real"
            alias = home / "alias"
            real.mkdir()
            alias.symlink_to(real, target_is_directory=True)
            compose = alias / "docker-compose.yml"
            resource = alias / "docker-compose.resource.yml"
            compose.write_text(YAML)
            resource.write_text("services:\n  family-hq:\n    mem_limit: 0\n")
            info = {"Config": {"Labels": {
                "com.docker.compose.project.config_files":
                    f"{real / 'docker-compose.yml'},{real / 'docker-compose.resource.yml'}"
            }}}
            with patch.object(p, "inspect_container", return_value=(info, OLD)), \
                 patch.object(p, "published_release", return_value=NEW), \
                 patch.object(p, "command", return_value=""):
                result = p.preflight("/path/to/docker", compose, resource, NEW)
            self.assertFalse(result["production_files_modified"])

    def test_refuses_unverified_release(self):
        with patch.object(p, "inspect_container", return_value=({}, OLD)), \
             patch.object(p, "published_release", return_value=OLD):
            with self.assertRaisesRegex(p.PreflightError, "newest verified"):
                p.preflight("/path/to/docker", Path("unused"), Path("unused"), NEW)
