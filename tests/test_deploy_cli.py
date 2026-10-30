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
THIRD = "c"*40


def manifest(main=OLD, voice=OLD):
    return (f"services:\n  family-hq:\n    image: ghcr.io/msaperst/family-hq:sha-{main}\n"
            "    restart: unless-stopped\n  voice-agent:\n"
            f"    image: ghcr.io/msaperst/family-hq-voice-agent:sha-{voice}\n"
            "    volumes:\n      - /certs:/run/certs:ro\n")


def args(base, original):
    compose = base / "original.yml"
    resource = base / "resource.yml"
    compose.write_text(original)
    resource.write_text("services: {}\n")
    return SimpleNamespace(docker="docker", python="python3", compose=compose,
                           resource=resource, state_dir=base/"state",
                           backup_dir=base/"backups", backup_script=base/"backup.py",
                           target_sha=NEW)


def revisions(main=OLD, voice=OLD, health="healthy"):
    return {"family-hq": main, "voice-agent": voice, "voice_health": health}


class CliDeployTests(unittest.TestCase):
    def test_stage_updates_both_only(self):
        original = manifest(OLD, THIRD)
        staged = d.stage(original, NEW, NEW)
        self.assertEqual(staged, manifest(NEW, NEW))
        self.assertIn("/certs:/run/certs:ro", staged)

    def test_stage_can_restore_mismatched_previous_pair(self):
        self.assertEqual(d.stage(manifest(NEW, NEW), OLD, THIRD), manifest(OLD, THIRD))

    def test_rejects_ambiguous_or_missing_images(self):
        for broken in (manifest() + manifest(), manifest().replace("voice-agent:sha-", "elsewhere:sha-"),
                       manifest().replace("family-hq:sha-", "other:sha-")):
            with self.subTest(broken=broken):
                with self.assertRaises(d.PreflightError):
                    d.stage(broken, NEW)

    def test_dry_run_does_not_change_manifest_or_containers(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            a=args(base, manifest(OLD, THIRD))
            with patch.object(d, "revisions", return_value=revisions(OLD, THIRD)), \
                 patch.object(d, "published_release", return_value=NEW), \
                 patch.object(d, "run", side_effect=AssertionError("unexpected docker")):
                result=d.deploy(a, False)
            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["from"], {"family-hq": OLD, "voice-agent": THIRD})
            self.assertEqual(a.compose.read_text(), manifest(OLD, THIRD))
            self.assertFalse((a.state_dir/"active.compose.yml").exists())

    def test_refuses_unverified_candidate(self):
        with tempfile.TemporaryDirectory() as folder:
            a = args(Path(folder), manifest())
            with patch.object(d, "revisions", return_value=revisions()), \
                 patch.object(d, "published_release", return_value=OLD):
                with self.assertRaisesRegex(d.PreflightError, "verified"):
                    d.deploy(a, False)

    def test_rejects_template_divergence(self):
        with tempfile.TemporaryDirectory() as folder:
            a=args(Path(folder),manifest())
            a.state_dir.mkdir()
            (a.state_dir/"active.compose.yml").write_text(manifest().replace("unless-stopped", "always"))
            with patch.object(d,"revisions",return_value=revisions()), \
                 patch.object(d,"published_release",return_value=NEW):
                with self.assertRaisesRegex(d.PreflightError,"diverged"):
                    d.deploy(a, False)

    def test_healthy_main_required_but_voice_health_is_optional(self):
        def fake(docker, name, require_healthy=False):
            if name == "family-hq":
                self.assertTrue(require_healthy)
                return OLD, "healthy"
            self.assertFalse(require_healthy)
            return OLD, "unhealthy"
        with patch.object(d, "inspect_container", side_effect=fake):
            actual=d.revisions("docker")
        self.assertEqual(actual["voice_health"], "unhealthy")

    def test_running_image_must_match_tag_and_compose_identity(self):
        info = {"Config": {"Image": d.IMAGES["voice-agent"]+OLD,
                           "Labels": {"com.docker.compose.project": "family-hq",
                                      "com.docker.compose.service": "voice-agent",
                                      "org.opencontainers.image.revision": OLD}},
                "State": {"Running": True, "Health": {"Status": "unhealthy"}}}
        with patch.object(d, "run", return_value=__import__("json").dumps([info])):
            sha, health = d.inspect_container("docker", "voice-agent")
            self.assertEqual((sha, health), (OLD, "unhealthy"))
            info["Config"]["Image"] = "arbitrary:latest"
            with self.assertRaises(d.PreflightError):
                d.inspect_container("docker", "voice-agent")

    def test_image_pull_precedes_any_container_recreation(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);a=args(base,manifest())
            volume=base/"volume";volume.mkdir()
            (volume/"family-hq.sqlite").write_bytes(b"database")
            calls=[]
            def fake_run(argv, timeout=180):
                calls.append(argv)
                if argv[1:3] == ["volume","inspect"]:
                    return str(volume)
                if "backup" in argv:
                    return "BACKUP_OK " + str(base/"snapshot.sqlite") + " bytes=128"
                return ""
            with patch.object(d,"revisions",return_value=revisions()), \
                 patch.object(d,"published_release",return_value=NEW), \
                 patch.object(d,"run",side_effect=fake_run), \
                 patch.object(d,"await_service",return_value="healthy"):
                out=d.deploy(a,True)
            self.assertEqual(out["status"],"deployed")
            self.assertTrue(any(argv[-3:] == ["pull","family-hq","voice-agent"] for argv in calls))
            self.assertEqual([argv[-1] for argv in calls if "up" in argv],
                             ["family-hq","voice-agent"])
            self.assertLess(next(i for i,x in enumerate(calls) if "pull" in x),
                            next(i for i,x in enumerate(calls) if "up" in x))
            self.assertNotIn("down", " ".join(" ".join(x) for x in calls))
            self.assertEqual((a.state_dir/"active.compose.yml").read_text(),manifest(NEW,NEW))

    def test_if_main_current_only_voice_is_recreated(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);a=args(base,manifest(NEW,OLD))
            volume=base/"volume";volume.mkdir()
            (volume/"family-hq.sqlite").write_bytes(b"database")
            calls=[]
            def fake_run(argv,timeout=180):
                calls.append(argv)
                if argv[1:3] == ["volume","inspect"]:
                    return str(volume)
                if "backup" in argv:
                    return "BACKUP_OK " + str(base/"snap") + " bytes=1"
                return ""
            with patch.object(d,"revisions",return_value=revisions(NEW,OLD)), \
                 patch.object(d,"published_release",return_value=NEW), \
                 patch.object(d,"run",side_effect=fake_run), \
                 patch.object(d,"await_service",return_value="unhealthy"):
                out=d.deploy(a,True)
            self.assertEqual([x[-1] for x in calls if "up" in x], ["voice-agent"])
            self.assertTrue(out["bridge_degraded"])
            self.assertEqual(out["voice_health"], "unhealthy")

    def test_voice_only_failure_never_recreates_dashboard(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);a=args(base,manifest(NEW,OLD))
            volume=base/"volume";volume.mkdir()
            (volume/"family-hq.sqlite").write_bytes(b"database")
            commands=[]
            def fake_run(argv,timeout=180):
                commands.append(argv)
                if argv[1:3] == ["volume","inspect"]: return str(volume)
                if "backup" in argv: return "BACKUP_OK " + str(base/"snap") + " bytes=1"
                return ""
            def health(docker,service,sha):
                if service == "voice-agent" and sha == NEW:
                    raise d.PreflightError("bridge startup failed")
                return "healthy"
            with patch.object(d,"revisions",return_value=revisions(NEW,OLD)), \
                 patch.object(d,"published_release",return_value=NEW), \
                 patch.object(d,"run",side_effect=fake_run), \
                 patch.object(d,"await_service",side_effect=health):
                with self.assertRaisesRegex(d.PreflightError,"previous image pair restored"):
                    d.deploy(a,True)
            self.assertEqual([x[-1] for x in commands if "up" in x],
                             ["voice-agent","voice-agent"])
            self.assertEqual((a.state_dir/"active.compose.yml").read_text(),manifest(NEW,OLD))

    def test_pull_failure_does_not_recreate_or_quarantine(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);a=args(base,manifest())
            volume=base/"volume";volume.mkdir()
            (volume/"family-hq.sqlite").write_bytes(b"database")
            calls=[]
            def fake_run(argv,timeout=180):
                calls.append(argv)
                if argv[1:3] == ["volume","inspect"]: return str(volume)
                if "backup" in argv: return "BACKUP_OK " + str(base/"snap") + " bytes=1"
                if "pull" in argv: raise d.PreflightError("registry offline")
                return ""
            with patch.object(d,"revisions",return_value=revisions()), \
                 patch.object(d,"published_release",return_value=NEW), \
                 patch.object(d,"run",side_effect=fake_run):
                with self.assertRaisesRegex(d.PreflightError,"Image preflight failed"):
                    d.deploy(a,True)
            self.assertFalse(any("up" in x for x in calls))
            self.assertEqual((a.state_dir/"active.compose.yml").read_text(),manifest())

    def test_failed_voice_rollout_restores_exact_previous_pair(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);a=args(base,manifest(OLD,THIRD))
            volume=base/"volume";volume.mkdir()
            (volume/"family-hq.sqlite").write_bytes(b"database")
            commands=[]
            def fake_run(argv,timeout=180):
                commands.append(argv)
                if argv[1:3] == ["volume","inspect"]: return str(volume)
                if "backup" in argv: return "BACKUP_OK " + str(base/"snap") + " bytes=1"
                return ""
            def health(docker,service,sha):
                if service=="voice-agent" and sha == NEW:
                    raise d.PreflightError("voice roll failed")
                return "healthy"
            with patch.object(d,"revisions",return_value=revisions(OLD,THIRD)), \
                 patch.object(d,"published_release",return_value=NEW), \
                 patch.object(d,"run",side_effect=fake_run), \
                 patch.object(d,"await_service",side_effect=health):
                with self.assertRaisesRegex(d.PreflightError,"previous image pair restored"):
                    d.deploy(a,True)
            self.assertEqual((a.state_dir/"active.compose.yml").read_text(),manifest(OLD,THIRD))
            self.assertEqual([x[-1] for x in commands if "up" in x],
                             ["family-hq","voice-agent","family-hq","voice-agent"])


if __name__ == "__main__":
    unittest.main()
