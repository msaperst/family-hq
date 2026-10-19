#!/usr/bin/env python3
"""Prepare a controlled deployment experiment. Never operates on Docker containers."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from deployment_preflight import preflight, prepare, inspect_container, PreflightError


def run(argv):
    p = subprocess.run(argv, text=True, capture_output=True, timeout=90, check=False)
    if p.returncode:
        raise PreflightError(f"Command failed ({p.returncode}): {p.stderr.strip()[:400]}")
    return p.stdout.strip()


def prepare_experiment(docker, python, compose, resource, sha, backup_script, backup_root, workdir):
    outcome = preflight(docker, compose, resource, sha)
    info, current = inspect_container(docker)
    if current != outcome["current_revision"]:
        raise PreflightError("Running revision changed since preflight")
    # The backup utility owns consistent snapshot creation, validation and retention.
    volume = run([docker, "volume", "inspect", "family-hq-data", "--format", "{{.Mountpoint}}"])
    database = Path(volume) / "family-hq.sqlite"
    if not database.is_file():
        raise PreflightError("Family HQ SQLite database is missing")
    if not backup_script.is_file():
        raise PreflightError("Backup script missing")
    backup_root = backup_root.resolve()
    before = set(backup_root.glob("family-hq-*.sqlite")) if backup_root.is_dir() else set()
    run([python, str(backup_script), "backup", "--db", str(database), "--root", str(backup_root)])
    after = set(backup_root.glob("family-hq-*.sqlite"))
    created = after - before
    if len(created) != 1:
        raise PreflightError("Could not identify exactly one newly created backup")
    snapshot = created.pop()
    run([python, str(backup_script), "verify", "--db", str(database),
         "--root", str(backup_root), "--snapshot", str(snapshot)])
    # Refuse stale experiment directories to avoid confusing old configurations.
    workdir.mkdir(parents=True, exist_ok=False, mode=0o700)
    os.chmod(workdir, 0o700)
    original = compose.read_text()
    candidate = workdir / "candidate.yml"
    candidate.write_text(prepare(original, current, sha))
    candidate.chmod(0o600)
    baseline = workdir / "baseline.yml"
    baseline.write_text(original)
    baseline.chmod(0o600)
    run([docker, "compose", "-p", "family-hq", "--project-directory", str(compose.parent),
         "-f", str(candidate), "-f", str(resource), "config", "--quiet"])
    return {
        "backup_verified": str(snapshot),
        "candidate_file": str(candidate),
        "baseline_file": str(baseline),
        "resource_file": str(resource),
        "project_directory": str(compose.parent),
        "current_revision": current,
        "target_revision": sha,
        "deployment_performed": False,
        "warning": "Do not deploy until Container Station synchronization and rollback procedure are approved",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("docker", "python", "compose", "resource", "target-sha",
                 "backup-script", "backup-root", "workdir"):
        parser.add_argument("--" + name, required=True)
    a = parser.parse_args()
    try:
        result = prepare_experiment(
            a.docker, a.python, Path(a.compose), Path(a.resource), a.target_sha,
            Path(a.backup_script), Path(a.backup_root), Path(a.workdir))
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"EXPERIMENT_PREP_FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
