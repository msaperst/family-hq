import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "deployment" / "check_release.py"
spec = importlib.util.spec_from_file_location("check_release", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
OLD = "a" * 40
NEW = "b" * 40


def publish_job(bridge="success", app="success"):
    return {"name": "Publish verified image to GHCR",
            "status": "completed", "conclusion": "success",
            "steps": [{"name": "Build and publish immutable voice bridge image",
                       "conclusion": bridge},
                      {"name": "Build and publish immutable commit tag",
                       "conclusion": app}]}


class DiscoveryTests(unittest.TestCase):
    def test_requires_both_publish_steps_for_same_main_commit(self):
        def getter(url):
            if "/jobs?" in url:
                return {"jobs": [publish_job()]}
            return {"workflow_runs": [{"id": 5, "head_sha": NEW,
                                      "status": "completed", "conclusion": "success"}]}
        self.assertEqual(module.published_release(getter), NEW)

    def test_skips_unpublished_newer_run(self):
        def getter(url):
            if "/runs/5/jobs?" in url:
                return {"jobs": [publish_job(bridge="failure", app="success")]}
            if "/runs/4/jobs?" in url:
                return {"jobs": [publish_job()]}
            return {"workflow_runs": [
                {"id": 5, "head_sha": NEW, "status": "completed", "conclusion": "success"},
                {"id": 4, "head_sha": OLD, "status": "completed", "conclusion": "success"},
            ]}
        self.assertEqual(module.published_release(getter), OLD)

    def test_skips_main_only_legacy_release(self):
        def getter(url):
            if "/jobs?" in url:
                return {"jobs": [{"name": "Publish verified image to GHCR",
                                  "status": "completed", "conclusion": "success"}]}
            return {"workflow_runs": [{"id": 1, "head_sha": OLD,
                                      "status": "completed", "conclusion": "success"}]}
        with self.assertRaisesRegex(RuntimeError, "pair"):
            module.published_release(getter)

    def test_skips_partial_step_success(self):
        for bridge, app in (("success", "failure"), ("skipped", "success"),
                            ("success", "skipped")):
            with self.subTest(bridge=bridge, app=app):
                def getter(url):
                    if "/jobs?" in url:
                        return {"jobs": [publish_job(bridge, app)]}
                    return {"workflow_runs": [{"id": 1, "head_sha": NEW,
                                              "status": "completed", "conclusion": "success"}]}
                with self.assertRaises(RuntimeError):
                    module.published_release(getter)

    def test_fails_closed_on_no_publish(self):
        with self.assertRaises(RuntimeError):
            module.published_release(lambda url: {"workflow_runs": []})

    def test_bad_sha_is_skipped(self):
        def getter(url):
            return {"workflow_runs": [{"id": 5, "head_sha": "nope",
                                      "status": "completed", "conclusion": "success"}]}
        with self.assertRaises(RuntimeError):
            module.published_release(getter)


if __name__ == "__main__":
    unittest.main()
