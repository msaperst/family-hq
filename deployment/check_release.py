#!/usr/bin/env python3
"""Read-only discovery of an entirely published Family HQ + voice image pair."""
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
VOICE_IMAGE = IMAGE + "-voice-agent"
SHA = re.compile(r"^[a-f0-9]{40}$")
PUBLISH_JOB = "Publish verified image to GHCR"
PUBLISH_STEPS = ("Build and publish immutable voice bridge image",
                 "Build and publish immutable commit tag")


def get_json(url):
    req = Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "family-hq-nas-release-check",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urlopen(req, timeout=15) as response:
        return json.load(response)


def published_release(getter=get_json):
    # A successful main push alone is not enough: BOTH image publish steps
    # must succeed in the same publish job for the same commit.
    query = f"{API}/repos/{REPO}/actions/workflows/{WORKFLOW}/runs?branch=main&event=push&per_page=10"
    runs = getter(query).get("workflow_runs", [])
    for workflow in runs:
        sha = workflow.get("head_sha", "")
        if not SHA.fullmatch(sha):
            continue
        if workflow.get("status") != "completed" or workflow.get("conclusion") != "success":
            continue
        jobs_url = f"{API}/repos/{REPO}/actions/runs/{workflow['id']}/jobs?per_page=100"
        jobs = getter(jobs_url).get("jobs", [])
        for job in jobs:
            if job.get("name") != PUBLISH_JOB or job.get("status") != "completed" or job.get("conclusion") != "success":
                continue
            steps = {step.get("name"): step for step in job.get("steps", [])}
            if all(steps.get(name, {}).get("conclusion") == "success" for name in PUBLISH_STEPS):
                return sha
    raise RuntimeError("No confirmed published main-branch image pair found; no action taken")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--running-revision", required=True,
                        help="Current Family HQ main image revision (40-character SHA)")
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
        "voice_image": f"{VOICE_IMAGE}:sha-{latest}",
        "update_available": latest != args.running_revision,
        "deployment_performed": False,
        # This legacy CLI compares only the main revision. The scheduled
        # poll_and_deploy.py compares both running container revisions.
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
