#!/usr/bin/env python3
"""NAS-side one-shot verified-release poller. Safe by default; --apply deploys."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError

from check_release import published_release
from deploy_cli import deploy, revision, PreflightError


def poll(args, release_getter=published_release, revision_getter=revision, deployer=deploy):
    # Resolve release only once. deploy_cli independently revalidates it before changes.
    current = revision_getter(args.docker)
    target = release_getter()
    if target == current:
        return {"status": "up_to_date", "revision": current, "deployment_performed": False}
    if not args.apply:
        return {"status": "update_available", "from": current, "to": target,
                "deployment_performed": False}
    args.target_sha = target
    return deployer(args, True)


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
