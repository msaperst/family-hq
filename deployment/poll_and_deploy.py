#!/usr/bin/env python3
"""NAS-side one-shot verified-release poller. Safe by default; --apply deploys."""
import argparse
import datetime as dt
import json
import os
import tempfile
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError

from check_release import published_release, SHA
from deploy_cli import deploy, revision, PreflightError


def quarantine_path(state_dir):
    return state_dir / "failed-release.json"


def read_quarantine(state_dir):
    path = quarantine_path(state_dir)
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    sha = data.get("sha")
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise PreflightError("Invalid failed-release quarantine file; refusing deployment")
    return sha


def record_failure(state_dir, sha):
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = quarantine_path(state_dir)
    fd, name = tempfile.mkstemp(prefix=".failed-release-", dir=state_dir)
    try:
        with os.fdopen(fd, "w") as output:
            os.fchmod(output.fileno(), 0o600)
            json.dump({"sha": sha, "failed_at": dt.datetime.now(dt.timezone.utc).isoformat()}, output)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def poll(args, release_getter=published_release, revision_getter=revision, deployer=deploy):
    current = revision_getter(args.docker)
    target = release_getter()
    if target == current:
        return {"status": "up_to_date", "revision": current, "deployment_performed": False}
    if not args.apply:
        return {"status": "update_available", "from": current, "to": target,
                "deployment_performed": False,
                "quarantined": read_quarantine(args.state_dir) == target}
    if read_quarantine(args.state_dir) == target:
        return {"status": "quarantined", "from": current, "to": target,
                "deployment_performed": False}
    args.target_sha = target
    try:
        return deployer(args, True)
    except PreflightError as exc:
        # Only quarantine after an attempted rollout failed. API races,
        # unreachable backups and preflight errors remain retryable.
        if str(exc).startswith("Deployment failed"):
            record_failure(args.state_dir, target)
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--docker", required=True)
    p.add_argument("--python", default=sys.executable)
    p.add_argument("--compose", type=Path, required=True)
    p.add_argument("--resource", type=Path, required=True)
    p.add_argument("--state-dir", type=Path, required=True)
    p.add_argument("--backup-dir", type=Path, required=True)
    p.add_argument("--backup-script", type=Path, required=True)
    p.add_argument("--apply", action="store_true",
                   help="Enable unattended rollout; requires explicit operator setup")
    args = p.parse_args()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        print(json.dumps({"timestamp": now, **poll(args)}, sort_keys=True), flush=True)
        return 0
    except (PreflightError, HTTPError, URLError, TimeoutError, ValueError, KeyError, OSError, RuntimeError) as exc:
        print(json.dumps({"timestamp": now, "status": "error",
                          "deployment_performed": False, "error": str(exc)}, sort_keys=True),
              file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
