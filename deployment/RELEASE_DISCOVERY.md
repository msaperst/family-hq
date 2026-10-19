# Release discovery (read-only)

Family HQ production images are published to GHCR by a successful main-branch GitHub Actions run. The NAS can check for newly published images without granting GitHub Actions access to the home network.

`deployment/check_release.py` queries the public GitHub Actions API for completed successful `main` push runs, and then confirms that the **Publish verified image to GHCR** job itself succeeded. It reports the current image revision, newest published image tag, and whether they differ. **It never pulls images, stops containers, modifies Compose files, changes database content, or performs a deployment.**

## Run manually on the NAS

Copy the reviewed script to a stable, private deployment directory. Use the actual `python3` and `docker` locations found on your NAS:

```sh
command -v python3
command -v docker

CONTAINER=family-hq-family-hq-1
RUNNING="$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
python3 /path/to/family-hq-deployment/check_release.py --running-revision "$RUNNING"
```

The result is JSON, for example:

```json
{
  "deployment_performed": false,
  "image": "ghcr.io/msaperst/family-hq:sha-<40-character-commit>",
  "latest_published_revision": "<40-character-commit>",
  "running_revision": "<40-character-commit>",
  "update_available": false
}
```

The checker exits nonzero if the GitHub API is unavailable or if no validated published release is found. It does not claim that an update is available when verification fails. The check uses public, unauthenticated API requests; rate limits apply.

## Deployments

An available image is **not** automatically approved for installation. The supported production method is an **operator-approved Container Station Applications → Recreate → Validate → Update** with only the pinned image tag changed. Keep the existing external `family-hq-data` volume, private environment file, localhost-only listener, and reverse-proxy configuration.

Do not edit generated Container Station files or use `docker compose down -v`. Before deploying, run and explicitly verify a fresh local SQLite backup. See [the deployment runbook](README.md) for the exact preflight, deployment, health check, and rollback sequence. For rollback, distinguish image rollback from SQLite schema rollback: a schema migration may require restoring the associated database snapshot.

## Tests

```sh
python3 -m unittest discover -s tests -p 'test_release_discovery.py' -v
```
