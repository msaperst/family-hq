#!/usr/bin/env python3
"""Opt-in NAS-initiated CLI rollout of one verified Family HQ image.

Docker Compose can make an application disappear from QNAP Container Station's
Applications list. This tradeoff is explicitly accepted for this deployment path.
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
from deployment_preflight import inspect_container, IMAGE, CONTAINER, SERVICE, PreflightError

IMAGE_LINE = re.compile(r"(?m)^(\s*image:\s*)(ghcr\.io/msaperst/family-hq:sha-[a-f0-9]{40})(\s*(?:#.*)?)$")


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
            raise PreflightError("Another deployment is already running") from exc
        yield


def stage(original, target):
    matches = list(IMAGE_LINE.finditer(original))
    if len(matches) != 1:
        raise PreflightError("Expected exactly one pinned Family HQ image line")
    match = matches[0]
    return original[:match.start(2)] + IMAGE + target + original[match.end(2):]


def revision(docker):
    _, sha = inspect_container(docker)
    return sha


def healthy(docker, sha, attempts=30, interval=2):
    for _ in range(attempts):
        try:
            if revision(docker) == sha:
                return
        except (PreflightError, OSError, ValueError, KeyError, subprocess.TimeoutExpired):
            pass
        time.sleep(interval)
    raise PreflightError("Timed out waiting for healthy container with expected image revision")


def deploy(a, execute):
    if not SHA.fullmatch(a.target_sha):
        raise PreflightError("Invalid target SHA")
    with lock(a.state_dir):
        current = revision(a.docker)
        if current == a.target_sha:
            return {"status": "already_current", "revision": current, "deployment_performed": False}
        if published_release() != a.target_sha:
            raise PreflightError("Target is not newest verified published main-branch release")

        original = a.compose.read_text()
        if not a.resource.is_file():
            raise PreflightError("Missing Container Station resource Compose file")
        # Staged Compose location is durable and never in /tmp.
        candidate = a.state_dir / "active.compose.yml"
        if candidate.is_file():
            old = candidate.read_text()
            # Detect unexpected edits beyond the image reference.
            if stage(old, current) != stage(original, current):
                raise PreflightError("Saved deployment template diverged from Container Station Compose")
        else:
            # Verify baseline image matches running instance before first takeover.
            if IMAGE + current not in original:
                raise PreflightError("Initial saved manifest does not match running image")
        proposed = stage(original, a.target_sha)
        compose_args = [a.docker, "compose", "-p", SERVICE, "--project-directory", str(a.compose.parent),
                        "-f", str(candidate), "-f", str(a.resource)]
        if not execute:
            return {"status": "ready", "from": current, "to": a.target_sha,
                    "deployment_performed": False, "container_station_ui_may_lose_application": True}

        # Backup utility takes SQLite online snapshot, validates, and atomically publishes it.
        volume = run([a.docker, "volume", "inspect", "family-hq-data", "--format", "{{.Mountpoint}}"])
        database = Path(volume) / "family-hq.sqlite"
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

        candidate.write_text(proposed)
        os.chmod(candidate, 0o600)
        try:
            run(compose_args + ["config", "--quiet"])
            # No down, no -v: retains the external SQLite volume.
            run(compose_args + ["up", "-d", "--no-deps", "--pull", "always", SERVICE], timeout=600)
            healthy(a.docker, a.target_sha)
        except Exception as failure:
            candidate.write_text(stage(original, current))
            os.chmod(candidate, 0o600)
            try:
                run(compose_args + ["config", "--quiet"])
                run(compose_args + ["up", "-d", "--no-deps", "--pull", "always", SERVICE], timeout=600)
                healthy(a.docker, current)
            except Exception as rollback_failure:
                raise PreflightError(f"Deployment failed: {failure}; IMAGE ROLLBACK ALSO FAILED: {rollback_failure}; snapshot={snapshot}") from rollback_failure
            raise PreflightError(f"Deployment failed; previous image restored: {failure}; snapshot={snapshot}") from failure

        return {"status": "deployed", "from": current, "to": a.target_sha,
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
    parser.add_argument("--apply", action="store_true", help="Explicitly approve container recreation")
    a = parser.parse_args()
    try:
        print(json.dumps(deploy(a, a.apply), sort_keys=True))
    except (PreflightError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(f"DEPLOY_ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
