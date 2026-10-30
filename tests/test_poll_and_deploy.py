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

OLD = "a" * 40
NEW = "b" * 40


def pair(main=OLD, voice=OLD, health="healthy"):
    return {"family-hq": main, "voice-agent": voice, "voice_health": health}


class PollTests(unittest.TestCase):
    def test_both_current_skips_deploy(self):
        def fail(*_): raise AssertionError("Deployment must not run")
        out = module.poll(SimpleNamespace(docker="docker", apply=True),
                          release_getter=lambda: OLD, revision_getter=lambda _: pair(),
                          deployer=fail)
        self.assertEqual(out["status"], "up_to_date")

    def test_outdated_sidecar_triggers_deploy_even_if_app_is_current(self):
        args = SimpleNamespace(docker="docker", apply=True,
                               state_dir=Path("/nonexistent-quarantine-test-dir"))
        observed = []
        def deployer(received, execute):
            observed.append((received.target_sha, execute))
            return {"status": "deployed", "deployment_performed": True}
        out = module.poll(args, release_getter=lambda: NEW,
                          revision_getter=lambda _: pair(main=NEW, voice=OLD),
                          deployer=deployer)
        self.assertTrue(out["deployment_performed"])
        self.assertEqual(observed, [(NEW, True)])

    def test_unhealthy_bridge_does_not_force_rollback_when_images_current(self):
        out = module.poll(SimpleNamespace(docker="docker", apply=True),
                          release_getter=lambda: OLD,
                          revision_getter=lambda _: pair(health="unhealthy"),
                          deployer=lambda *_: self.fail("deployed"))
        self.assertEqual(out["status"], "up_to_date")
        self.assertEqual(out["voice_health"], "unhealthy")

    def test_default_is_read_only(self):
        out = module.poll(SimpleNamespace(docker="docker", apply=False,
                                         state_dir=Path("/nonexistent-quarantine-test-dir")),
                          release_getter=lambda: NEW,
                          revision_getter=lambda _: pair())
        self.assertEqual(out["status"], "update_available")
        self.assertFalse(out["deployment_performed"])

    def test_release_failure_cannot_trigger_deploy(self):
        def fail_release(): raise RuntimeError("GitHub unavailable")
        with self.assertRaisesRegex(RuntimeError, "unavailable"):
            module.poll(SimpleNamespace(docker="docker", apply=True),
                        release_getter=fail_release, revision_getter=lambda _: pair(),
                        deployer=lambda *_: self.fail("deployment called"))

    def test_failed_rollout_is_quarantined_and_not_retried(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            attempts = []
            def broken(*_):
                attempts.append("deploy")
                raise module.PreflightError("Deployment failed; previous image pair restored")
            with self.assertRaises(module.PreflightError):
                module.poll(args, release_getter=lambda: NEW,
                            revision_getter=lambda _: pair(), deployer=broken)
            out = module.poll(args, release_getter=lambda: NEW,
                              revision_getter=lambda _: pair(), deployer=broken)
            self.assertEqual(out["status"], "quarantined")
            self.assertEqual(attempts, ["deploy"])
            self.assertEqual(module.read_quarantine(args.state_dir), NEW)

    def test_newer_release_is_not_quarantined(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            module.record_failure(args.state_dir, NEW)
            newer = "c" * 40
            out = module.poll(args, release_getter=lambda: newer,
                              revision_getter=lambda _: pair(),
                              deployer=lambda *_: {"status": "deployed"})
            self.assertEqual(out["status"], "deployed")

    def test_preflight_errors_do_not_quarantine(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            with self.assertRaisesRegex(module.PreflightError, "image pull"):
                module.poll(args, release_getter=lambda: NEW,
                            revision_getter=lambda _: pair(),
                            deployer=lambda *_: (_ for _ in ()).throw(module.PreflightError("image pull unavailable")))
            self.assertIsNone(module.read_quarantine(args.state_dir))

    def test_corrupt_quarantine_blocks_apply(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(docker="docker", apply=True, state_dir=Path(folder))
            (args.state_dir / "failed-release.json").write_text('{"sha": "invalid"}')
            with self.assertRaisesRegex(module.PreflightError, "Invalid failed-release"):
                module.poll(args, release_getter=lambda: NEW,
                            revision_getter=lambda _: pair(),
                            deployer=lambda *_: self.fail("deployed"))


if __name__ == "__main__":
    unittest.main()
