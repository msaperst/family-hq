import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

DEPLOY = Path(__file__).resolve().parents[1] / "deployment"
sys.path.insert(0, str(DEPLOY))
spec = importlib.util.spec_from_file_location("poll_and_deploy", DEPLOY / "poll_and_deploy.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

OLD = "a"*40
NEW = "b"*40

class PollTests(unittest.TestCase):
    def test_no_change_skips_deploy(self):
        def fail(*_): raise AssertionError("Deployment must not run")
        out = module.poll(SimpleNamespace(docker="docker", apply=True),
                          release_getter=lambda: OLD, revision_getter=lambda _: OLD,
                          deployer=fail)
        self.assertEqual(out["status"], "up_to_date")

    def test_default_is_read_only(self):
        def fail(*_): raise AssertionError("Deployment must not run")
        out = module.poll(SimpleNamespace(docker="docker", apply=False),
                          release_getter=lambda: NEW, revision_getter=lambda _: OLD,
                          deployer=fail)
        self.assertEqual(out["status"], "update_available")
        self.assertFalse(out["deployment_performed"])

    def test_apply_passes_verified_target_into_existing_controller(self):
        args = SimpleNamespace(docker="docker", apply=True)
        observed = []
        def deployer(received, execute):
            observed.append((received.target_sha, execute))
            return {"status": "deployed", "deployment_performed": True}
        out = module.poll(args, release_getter=lambda: NEW,
                          revision_getter=lambda _: OLD, deployer=deployer)
        self.assertEqual(observed, [(NEW, True)])
        self.assertTrue(out["deployment_performed"])

    def test_release_failure_cannot_trigger_deploy(self):
        def fail_release(): raise RuntimeError("GitHub unavailable")
        with self.assertRaisesRegex(RuntimeError, "unavailable"):
            module.poll(SimpleNamespace(docker="docker",apply=True),
                        release_getter=fail_release, revision_getter=lambda _: OLD,
                        deployer=lambda *_: self.fail("deployment called"))

if __name__ == "__main__":
    unittest.main()
