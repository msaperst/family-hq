#!/usr/bin/env python3
"""Read-only preflight for a proposed Container Station image update.

No Docker create/start/stop/pull, Compose up/down or production file writes.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from check_release import published_release

SHA = re.compile(r"^[a-f0-9]{40}$")
IMAGE = "ghcr.io/msaperst/family-hq:sha-"
SERVICE = "family-hq"
CONTAINER = "family-hq-family-hq-1"


class PreflightError(RuntimeError):
    pass


def command(argv):
    result = subprocess.run(argv, capture_output=True, text=True, check=False, timeout=45)
    if result.returncode:
        raise PreflightError(f"{argv[0]} command failed (exit {result.returncode}): {result.stderr.strip()[:500]}")
    return result.stdout.strip()


def inspect_container(docker):
    details = json.loads(command([docker, "inspect", CONTAINER]))
    if len(details) != 1:
        raise PreflightError("Expected one Family HQ container")
    info = details[0]
    labels = info["Config"].get("Labels") or {}
    if labels.get("com.docker.compose.project") != SERVICE or labels.get("com.docker.compose.service") != SERVICE:
        raise PreflightError("Container does not belong to the expected Compose project and service")
    if not info["State"].get("Running") or info["State"].get("Health", {}).get("Status") != "healthy":
        raise PreflightError("Family HQ is not running and healthy")
    running = labels.get("org.opencontainers.image.revision", "")
    if not SHA.fullmatch(running):
        raise PreflightError("Running image revision is missing or invalid")
    return info, running


def prepare(compose_text, running, target):
    matches = list(re.finditer(r"(?m)^([ \t]+image:[ \t]*)([^\r\n#]+)([ \t]*(?:#.*)?)$", compose_text))
    if len(matches) != 1:
        raise PreflightError("Expected exactly one image line; refusing ambiguous Compose config")
    match = matches[0]
    value = match.group(2).strip().strip("'\"")
    if value != IMAGE + running:
        raise PreflightError("Saved Container Station image disagrees with running revision")
    return compose_text[:match.start(2)] + IMAGE + target + compose_text[match.end(2):]


def preflight(docker, compose, resource, target):
    if not SHA.fullmatch(target):
        raise PreflightError("Target must be a full 40-character lowercase commit SHA")
    info, running = inspect_container(docker)
    if published_release() != target:
        raise PreflightError("Target is not the newest verified GHCR release")
    labels = info["Config"]["Labels"]
    files = labels.get("com.docker.compose.project.config_files", "").split(",")
    expected = [str(compose.resolve()), str(resource.resolve())]
    if files != expected:
        raise PreflightError("Provided Compose files do not exactly match container ownership labels")
    original = compose.read_text()
    staged = prepare(original, running, target)
    # Keep staging outside the QNAP-managed configuration directory.
    with tempfile.TemporaryDirectory(prefix="family-hq-preflight-") as work:
        candidate = Path(work) / "docker-compose.yml"
        candidate.write_text(staged)
        # Setting project directory explicitly makes relative references resolve as in production.
        command([docker, "compose", "--project-directory", str(compose.parent),
                 "-f", str(candidate), "-f", str(resource), "config", "--quiet"])
    if compose.read_text() != original:
        raise PreflightError("Container Station configuration changed during preflight")
    return {
        "current_revision": running,
        "target_revision": target,
        "candidate_image": IMAGE + target,
        "compose_validation": "passed",
        "production_files_modified": False,
        "deployment_performed": False,
        "requires_manual_approval": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", required=True, help="Absolute Docker executable path")
    parser.add_argument("--compose", type=Path, required=True, help="Container Station application Compose file")
    parser.add_argument("--resource", type=Path, required=True, help="Container Station resource Compose file")
    parser.add_argument("--target-sha", required=True, help="Approved candidate full commit SHA")
    args = parser.parse_args()
    try:
        result = preflight(args.docker, args.compose, args.resource, args.target_sha)
    except (PreflightError, OSError, ValueError, KeyError, subprocess.TimeoutExpired, RuntimeError) as exc:
        print(f"PREFLIGHT_FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
