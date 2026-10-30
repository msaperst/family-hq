#!/usr/bin/env python3
"""NAS-initiated paired rollout of Family HQ and its outbound voice bridge.

Both images use the same verified commit SHA. This script never performs
'compose down', removes volumes, or exposes any inbound NAS port.
CLI Compose takeover can detach the application from QNAP's Applications UI;
the persistent active.compose.yml becomes the deployment authority.
"""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from check_release import published_release, SHA
from check_release import IMAGE as BASE_IMAGE

SERVICE = "family-hq"
SERVICES = ("family-hq", "voice-agent")
CONTAINERS = {"family-hq": "family-hq-family-hq-1",
              "voice-agent": "family-hq-voice-agent-1"}
IMAGES = {"family-hq": BASE_IMAGE + ":sha-",
          "voice-agent": BASE_IMAGE + "-voice-agent:sha-"}
IMAGE_LINES = {
    service: re.compile(r"(?m)^([ \t]*image:[ \t]*)(" +
                        re.escape(prefix) + r"([a-f0-9]{40}))([ \t]*(?:#.*)?)$")
    for service, prefix in IMAGES.items()
}


class PreflightError(RuntimeError):
    pass


def run(argv, timeout=180):
    p = subprocess.run(argv, text=True, capture_output=True, timeout=timeout, check=False)
    if p.returncode:
        raise PreflightError(f"Command failed ({p.returncode}): {argv[0]} {argv[1] if len(argv)>1 else ''}: {p.stderr.strip()[:500]}")
    return p.stdout.strip()


@contextmanager
def lock(root):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    with (root / ".deploy.lock").open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise PreflightError("Another deployment may be running") from exc
        yield


def stage(original, app_sha, voice_sha=None):
    """Change ONLY the two exact GHCR image values, preserving all other YAML.

    Used for both candidate manifests and template drift detection.
    """
    voice_sha = app_sha if voice_sha is None else voice_sha
    if not SHA.fullmatch(app_sha) or not SHA.fullmatch(voice_sha):
        raise PreflightError("Invalid image revision")
    updated = original
    for service, sha in (("family-hq", app_sha), ("voice-agent", voice_sha)):
        pattern = IMAGE_LINES[service]
        matches = list(pattern.finditer(updated))
        if len(matches) != 1:
            raise PreflightError(f"Expected exactly one pinned {service} image line")
        match = matches[0]
        updated = updated[:match.start(2)] + IMAGES[service] + sha + updated[match.end(2):]
    return updated


def inspect_container(docker, service, require_healthy=False):
    data = json.loads(run([docker, "inspect", CONTAINERS[service]]))
    if len(data) != 1:
        raise PreflightError(f"Expected one {service} container")
    info = data[0]
    labels = info["Config"].get("Labels") or {}
    if labels.get("com.docker.compose.project") != SERVICE or labels.get("com.docker.compose.service") != service:
        raise PreflightError(f"Unexpected {service} Compose identity")
    if not info["State"].get("Running"):
        raise PreflightError(f"{service} is not running")
    health = (info["State"].get("Health") or {}).get("Status", "not_configured")
    if require_healthy and health != "healthy":
        raise PreflightError(f"{service} is not healthy")
    sha = labels.get("org.opencontainers.image.revision", "")
    if not SHA.fullmatch(sha):
        raise PreflightError(f"{service} has invalid or absent image revision")
    expected_ref = IMAGES[service] + sha
    if info["Config"].get("Image") != expected_ref:
        raise PreflightError(f"{service} running image is not the expected pinned GHCR tag")
    return sha, health


def revisions(docker):
    """The bridge may be unhealthy during AWS downtime; still track its image."""
    app, _ = inspect_container(docker, "family-hq", require_healthy=True)
    voice, voice_health = inspect_container(docker, "voice-agent")
    return {"family-hq": app, "voice-agent": voice, "voice_health": voice_health}


def revision(docker):
    """Legacy single-app revision reader, for older tooling."""
    return inspect_container(docker, "family-hq", require_healthy=True)[0]


def await_service(docker, service, sha, attempts=30, interval=2):
    for _ in range(attempts):
        try:
            actual, health = inspect_container(
                docker, service, require_healthy=(service == "family-hq"))
            if actual == sha:
                return health
        except (PreflightError, OSError, ValueError, KeyError, subprocess.TimeoutExpired):
            pass
        time.sleep(interval)
    raise PreflightError(f"Timed out waiting for running {service} image revision")


def write_manifest(path, content):
    path.write_text(content)
    os.chmod(path, 0o600)


def compose_command(a, candidate):
    return [a.docker, "compose", "-p", SERVICE,
            "--project-directory", str(a.compose.parent),
            "-f", str(candidate), "-f", str(a.resource)]


def update_service(compose, service):
    # Service-targeted. No dependency recreation, no 'down', no volume deletion.
    run(compose + ["up", "-d", "--no-deps", "--pull", "never", service], timeout=600)


def deploy(a, execute):
    if not SHA.fullmatch(a.target_sha):
        raise PreflightError("Invalid target SHA")
    with lock(a.state_dir):
        current = revisions(a.docker)
        previous = {service: current[service] for service in SERVICES}
        if all(previous[service] == a.target_sha for service in SERVICES):
            return {"status": "already_current", "revisions": previous,
                    "voice_health": current["voice_health"], "deployment_performed": False}
        if published_release() != a.target_sha:
            raise PreflightError("Target is not newest verified paired main-branch release")

        original = a.compose.read_text()
        if not a.resource.is_file():
            raise PreflightError("Missing Container Station resource Compose file")
        # Fail closed if one service is missing or image tags are ambiguous.
        staged_previous = stage(original, previous["family-hq"], previous["voice-agent"])
        candidate = a.state_dir / "active.compose.yml"
        if candidate.exists():
            saved = candidate.read_text()
            if stage(saved, previous["family-hq"], previous["voice-agent"]) != staged_previous:
                raise PreflightError("Saved deployment template diverged from Container Station Compose")
        elif original != staged_previous:
            raise PreflightError("Initial saved manifest does not match running paired image tags")

        proposed = stage(original, a.target_sha, a.target_sha)
        if not execute:
            return {"status": "ready", "from": previous, "to": a.target_sha,
                    "voice_health": current["voice_health"], "deployment_performed": False,
                    "container_station_ui_may_lose_application": True}

        # Consistent backup and verification precede any container change.
        mountpoint = run([a.docker, "volume", "inspect", "family-hq-data",
                          "--format", "{{.Mountpoint}}"])
        database = Path(mountpoint) / "family-hq.sqlite"
        if not database.is_file():
            raise PreflightError("Live database is inaccessible; run with adequate privileges")
        backup = run([a.python, str(a.backup_script), "backup", "--db", str(database),
                      "--root", str(a.backup_dir)], timeout=240)
        match = re.search(r"^BACKUP_OK (.+?) bytes=\d+$", backup, re.MULTILINE)
        if not match:
            raise PreflightError("Backup utility did not confirm success")
        snapshot = Path(match.group(1))
        run([a.python, str(a.backup_script), "verify", "--db", str(database),
             "--root", str(a.backup_dir), "--snapshot", str(snapshot)], timeout=120)

        write_manifest(candidate, proposed)
        command = compose_command(a, candidate)
        # Pre-pull BOTH images before restarting either container. Registry
        # availability errors must not trigger an avoidable service outage.
        try:
            run(command + ["config", "--quiet"])
            run(command + ["pull", "family-hq", "voice-agent"], timeout=600)
        except Exception as exc:
            write_manifest(candidate, staged_previous)
            raise PreflightError(f"Image preflight failed without container changes: {exc}") from exc

        try:
            if previous["family-hq"] != a.target_sha:
                update_service(command, "family-hq")
                await_service(a.docker, "family-hq", a.target_sha)
            if previous["voice-agent"] != a.target_sha:
                update_service(command, "voice-agent")
            voice_health = await_service(a.docker, "voice-agent", a.target_sha)
        except Exception as failure:
            # Restore the exact previous pair, including mismatched pre-existing
            # versions. The voice-agent connection state is not a prerequisite
            # for bringing back the family's LAN dashboard.
            write_manifest(candidate, staged_previous)
            try:
                run(command + ["config", "--quiet"])
                update_service(command, "family-hq")
                await_service(a.docker, "family-hq", previous["family-hq"])
                update_service(command, "voice-agent")
                await_service(a.docker, "voice-agent", previous["voice-agent"])
            except Exception as rollback_failure:
                raise PreflightError(f"Deployment failed: {failure}; IMAGE ROLLBACK ALSO FAILED: {rollback_failure}; snapshot={snapshot}") from rollback_failure
            raise PreflightError(f"Deployment failed; previous image pair restored: {failure}; snapshot={snapshot}") from failure

        return {"status": "deployed", "from": previous, "to": a.target_sha,
                "voice_health": voice_health, "bridge_degraded": voice_health != "healthy",
                "backup_verified": str(snapshot), "deployment_performed": True,
                "container_station_ui_may_lose_application": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", required=True)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--compose", type=Path, required=True)
    parser.add_argument("--resource", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--backup-script", type=Path, required=True)
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--apply", action="store_true", help="Explicitly approve paired container rollout")
    a = parser.parse_args()
    try:
        print(json.dumps(deploy(a, a.apply), sort_keys=True))
    except (PreflightError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(f"DEPLOY_ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
