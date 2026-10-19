#!/usr/bin/env python3
"""Read-only discovery of a successfully published Family HQ image."""
import argparse
import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API = "https://api.github.com"
REPO = "msaperst/family-hq"
WORKFLOW = "ci.yml"
IMAGE = "ghcr.io/msaperst/family-hq"
SHA = re.compile(r"^[a-f0-9]{40}$")


def get_json(url):
    req = Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "family-hq-nas-release-check",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urlopen(req, timeout=15) as response:
        return json.load(response)


def published_release(getter=get_json):
    # Only workflow runs on main are candidates. Jobs must explicitly confirm
    # the image publishing step succeeded, not merely that app tests passed.
    query = f"{API}/repos/{REPO}/actions/workflows/{WORKFLOW}/runs?branch=main&event=push&per_page=10"
    runs = getter(query).get("workflow_runs", [])
    for run in runs:
        sha = run.get("head_sha", "")
        if not SHA.fullmatch(sha):
            continue
        if run.get("status") != "completed" or run.get("conclusion") != "success":
            continue
        jobs_url = f"{API}/repos/{REPO}/actions/runs/{run['id']}/jobs?per_page=100"
        jobs = getter(jobs_url).get("jobs", [])
        if any(job.get("name") == "Publish verified image to GHCR"
               and job.get("status") == "completed"
               and job.get("conclusion") == "success" for job in jobs):
            return sha
    raise RuntimeError("No confirmed published main-branch image found; no action taken")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--running-revision", required=True,
                        help="Current container org.opencontainers.image.revision (40-character SHA)")
    args = parser.parse_args()
    if not SHA.fullmatch(args.running_revision):
        parser.error("--running-revision must be a 40-character lowercase commit SHA")
    try:
        latest = published_release()
    except (HTTPError, URLError, TimeoutError, ValueError, KeyError, RuntimeError) as exc:
        print(f"RELEASE_CHECK_ERROR {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "running_revision": args.running_revision,
        "latest_published_revision": latest,
        "image": f"{IMAGE}:sha-{latest}",
        "update_available": latest != args.running_revision,
        "deployment_performed": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
