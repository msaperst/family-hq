import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
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
        out = module.poll(SimpleNamespace(docker="docker", apply=False, state_dir=Path("/nonexistent-quarantine-test-dir")),
                          release_getter=lambda: NEW, revision_getter=lambda _: OLD,
                          deployer=fail)
        self.assertEqual(out["status"], "update_available")
        self.assertFalse(out["deployment_performed"])

    def test_apply_passes_verified_target_into_existing_controller(self):
        args = SimpleNamespace(docker="docker", apply=True, state_dir=Path("/nonexistent-quarantine-test-dir"))
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

    def test_failed_rollout_is_quarantined_and_not_retried(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            attempts = []
            def broken(*_):
                attempts.append("deploy")
                raise module.PreflightError("Deployment failed; previous image restored")
            with self.assertRaisesRegex(module.PreflightError, "previous image restored"):
                module.poll(args, release_getter=lambda: NEW,
                            revision_getter=lambda _: OLD, deployer=broken)
            out = module.poll(args, release_getter=lambda: NEW,
                              revision_getter=lambda _: OLD, deployer=broken)
            self.assertEqual(out["status"], "quarantined")
            self.assertEqual(attempts, ["deploy"])
            self.assertEqual(module.read_quarantine(args.state_dir), NEW)

    def test_newer_release_is_not_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            module.record_failure(args.state_dir, NEW)
            newer = "c"*40
            invoked = []
            out = module.poll(args, release_getter=lambda: newer,
                              revision_getter=lambda _: OLD,
                              deployer=lambda a, execute: invoked.append((a.target_sha, execute)) or {"status": "deployed"})
            self.assertEqual(out["status"], "deployed")
            self.assertEqual(invoked, [(newer, True)])

    def test_preflight_errors_do_not_quarantine(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            with self.assertRaisesRegex(module.PreflightError, "backup inaccessible"):
                module.poll(args, release_getter=lambda: NEW,
                            revision_getter=lambda _: OLD,
                            deployer=lambda *_: (_ for _ in ()).throw(module.PreflightError("backup inaccessible")))
            self.assertIsNone(module.read_quarantine(args.state_dir))

    def test_corrupt_quarantine_blocks_apply(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            (args.state_dir / "failed-release.json").write_text('{"sha": "invalid"}')
            with self.assertRaisesRegex(module.PreflightError, "Invalid failed-release"):
                module.poll(args, release_getter=lambda: NEW,
                            revision_getter=lambda _: OLD, deployer=lambda *_: self.fail("deployed"))

if __name__ == "__main__":
    unittest.main()
