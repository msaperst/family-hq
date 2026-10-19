# Controlled deployment experiment

This is a **preparation tool**, not an automated deployer. It creates a fresh verified SQLite snapshot, stages a candidate image-only Compose configuration, and preserves the original Compose configuration for comparison. No Docker container is pulled, stopped, recreated, or otherwise changed.

The underlying Container Station-managed Compose files stay untouched. The experiment must not be scheduled; it requires an operator to review the result and separately authorize any live change.

## Prepare

Confirm the existing application is healthy and the documented read-only deployment preflight succeeds first. Copy `prepare_deployment_experiment.py`, `deployment_preflight.py`, and `check_release.py` together into a stable private directory on the NAS.

Use the actual executable locations reported by `command -v docker` and `command -v python3`. These placeholders deliberately omit host-specific paths from the repository:

```sh
CONTAINER=family-hq-family-hq-1
DOCKER="$(command -v docker)"
PYTHON="$(command -v python3)"
APP_DIR="$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"

"$PYTHON" /path/to/deployment/prepare_deployment_experiment.py \
  --docker "$DOCKER" \
  --python "$PYTHON" \
  --compose "$APP_DIR/docker-compose.yml" \
  --resource "$APP_DIR/docker-compose.resource.yml" \
  --target-sha <latest-verified-full-40-character-sha> \
  --backup-script /path/to/deployment/family_hq_backup.py \
  --backup-root /path/to/private/backups \
  --workdir /path/to/private/experiment-unique-id
```

Choose a **new, private work directory** for each preparation. The utility refuses to reuse an existing one. If privileged access is required to read the Docker volume or create its backup, invoke with appropriate permissions rather than relaxing the application's directory or database permissions.

The JSON output identifies the verified backup snapshot and both staged files. `deployment_performed` is always `false`.

## What is deliberately not automated yet

A passing staged Compose check does not prove that `docker compose up` using a separate config preserves Container Station's own application state. Such a command may create container labels referencing the staged file, diverge from the UI's saved application YAML, and break subsequent Recreate operations.

**Do not run a CLI update against the running Compose project merely because preparation passed.** The first update experiment needs an explicitly reviewed recovery plan, including verification of Container Station's Recreate UI, ownership labels, service health, database contents, and restoration of the original image if the integration is incompatible.

A rollback of the Docker image alone cannot reverse incompatible SQLite migrations. Retain and verify the predeployment snapshot until data compatibility has been checked. Do not delete or edit QNAP-managed Compose files and never remove the external database volume.

## Test

```sh
python3 -m unittest discover -s tests -p 'test_deployment_experiment.py' -v
```
