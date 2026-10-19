# Family HQ — GHCR image deployment

This is the image-only QNAP Container Station deployment path. GitHub builds an amd64 Docker image on `main` only after typechecking, tests, Playwright, Sonar quality gate, Docker smoke, and vulnerability scan succeed. No GitHub workflow connects to the NAS, and **publishing never automatically deploys** an image.

## Image release

A successful `main` workflow publishes:

`ghcr.io/msaperst/family-hq:sha-<full-40-character-commit-sha>`

The tag records the code revision. Use a tag tied to a known passing workflow; for stronger image pinning use the image's `@sha256:...` digest after it is published. We intentionally do not deploy from `latest`.

Check the repository's Actions run and GHCR package visibility first. A public repository does **not** guarantee its GHCR package is public. Either make this image package public in GitHub package settings (preferred for this LAN-only application with no embedded secrets) or configure read-only GHCR access on the NAS. Do **not** place a registry token in committed YAML.

## NAS bootstrap (once)

1. In Container Station, confirm `family-hq-data` exists or create it with `docker volume create family-hq-data`. Keep this volume on every update.
2. On the NAS, prepare `/share/Container/family-hq/.env.production` from `calendar.env.example`. Copy the Google Calendar credentials privately from the working setup and run `chmod 600 /share/Container/family-hq/.env.production`. All four settings must be supplied together or left empty. Never print this file in logs.
3. Open `container-station.compose.yaml`, substitute the **exact tested image tag**, and paste/upload the YAML in Container Station **Applications → Create**. Set application name to `family-hq`. This manifest has **no `build:`** and does not require Git or Node.js on the NAS.
4. Validate that Container Station can resolve the absolute `env_file` path. If its Compose integration cannot read local environment files, **stop** and choose a NAS-local secrets mechanism; do not copy secrets into a public GitHub issue or repo. Also confirm it permits a loopback host binding; never replace it with unrestricted `0.0.0.0`.
5. Validate the container reports healthy and `curl -fsS http://127.0.0.1:3080/api/health` works from the NAS.
6. Configure the existing **same-host HTTPS reverse proxy** to forward to `127.0.0.1:3080`, with a source-IP allowlist restricted to trusted household subnets. Configure internal DNS separately. Do not publish the HTTP port externally.

QNAP's built-in proxy must accept the selected HTTPS listener and a valid certificate. Keep other QNAP services and any existing application volumes untouched.

## NAS-side CLI deployment

The NAS can initiate an image-only update using [`deploy_cli.py`](deploy_cli.py), with a fresh verified SQLite backup and automatic **image** rollback if deployment or health checks fail. This uses a **persistent staged Compose file** and leaves QNAP's saved YAML untouched.

**Accepted tradeoff:** Container Station may no longer list the application under **Applications** after a CLI update, even while the container is running and managed by Docker Compose. We reproduced this on a disposable QNAP application; restoring its original Compose labels did not restore the UI listing. Treat Docker Compose, not QNAP's Applications view, as the deployment authority after switching to the CLI method. Do not edit QNAP-generated Compose files directly.

The first rollout must be explicitly approved and observed. There is **no scheduled or unattended deployment** in this PR.

### One-time setup

Place `check_release.py`, `deploy_cli.py` and `family_hq_backup.py` together in a private, stable location on the NAS. The deployment state directory must be persistent (not under `/tmp`), writable only by an administrative account, and distinct from the SQLite Docker volume. Run the script with privileges sufficient to access the Docker socket and SQLite backup path.

Use the application Compose and resource-file locations recorded by the running container. Use the existing stable backup directory and verify its normal scheduled backups remain in place.

### Prepare (read-only dry run)

```sh
CONTAINER=family-hq-family-hq-1
DOCKER="$(command -v docker)"
PYTHON="$(command -v python3)"
APP_DIR="$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
RUNNING="$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
TARGET="$("$PYTHON" /path/to/deployment/check_release.py --running-revision "$RUNNING" | "$PYTHON" -c 'import json,sys; print(json.load(sys.stdin)["latest_published_revision"])')"

sudo "$PYTHON" /path/to/deployment/deploy_cli.py \
  --docker "$DOCKER" --python "$PYTHON" \
  --compose "$APP_DIR/docker-compose.yml" \
  --resource "$APP_DIR/docker-compose.resource.yml" \
  --state-dir /path/to/private/deploy-state \
  --backup-dir /path/to/private/backups \
  --backup-script /path/to/deployment/family_hq_backup.py \
  --target-sha "$TARGET"
```

Without `--apply`, the script does not create backups, edit files, or change containers.

### Deploy (requires explicit approval)

After reviewing the target image and dry-run result, repeat the same `deploy_cli.py` command with **`--apply`**. The script holds a deployment lock, validates the target against the newest successfully published image on `main`, creates a consistent SQLite snapshot, verifies the backup, writes `active.compose.yml` into the persistent state directory, validates Compose, and runs a service-only `docker compose up -d --no-deps --pull always`. It then waits for the expected healthy image revision.

On failure, the script attempts to reapply the previous image through the *same persistent Compose path* and waits for health. If rollback also fails, an explicit failure is emitted. In either case the printed backup path is for recovery; the tool **does not automatically restore an older database**.

### Validation and recovery

After success, verify `docker compose ls --all`, running image revision, Docker health, localhost `/api/health`, reverse-proxied browser UI, and representative chore/calendar data. Keep the backup snapshot available. An image rollback does **not** reverse incompatible SQLite migrations; stop Family HQ and use the separately tested [SQLite restore procedure](../docs/LOCAL_SQLITE_BACKUP.md) if a database restore is required. Never run `docker compose down -v` or delete `family-hq-data`.

Subsequent CLI deployments reuse the stable staged Compose path, not a disposable `/tmp` file. If Container Station changes the saved YAML independently, the script refuses to proceed when the templates no longer match. Do not alternate between Container Station Recreate and the CLI deployer without reconciling the configuration.


## Scheduled release checks (NAS pull)

`poll_and_deploy.py` ties together release discovery and the proven `deploy_cli.py` controller. It checks the healthy running revision, resolves the latest published `main` image, and exits without a deployment if the images match. In its **default read-only mode**, it only reports an available update. With `--apply`, it delegates to the existing deployment controller, which independently revalidates the release, obtains a deployment lock, performs a verified SQLite backup, upgrades via persistent Compose, health-checks the new revision, and attempts image rollback on failure.

This is NAS-initiated; GitHub Actions has no inbound access to the network.

Copy `poll_and_deploy.py`, `deploy_cli.py`, `check_release.py`, and `family_hq_backup.py` to the NAS deployment scripts directory. Then copy [`run-release-check.sh.example`](run-release-check.sh.example) to a private NAS-local `run-release-check.sh` and set the actual absolute Docker/Python paths and scripts, backup, and state directories. **Do not run the example unchanged.** Set the wrapper executable and run it manually; inspect the JSON output. It defaults to `AUTO_DEPLOY=no`, so this initial run does not change the container.

To schedule read-only checks on QNAP, add an entry to the NAS's persistent `/etc/config/crontab` using the local wrapper path, for example:

```cron
17 * * * * /absolute/path/to/run-release-check.sh >> /absolute/path/to/private/release-check.log 2>&1
```

Reload QNAP's cron service using the documented procedure and verify both persistent and active crontab entries. Avoid duplicate entries. **This repository does not install or enable cron.** When ready to authorize unattended image updates, set `AUTO_DEPLOY=yes` in the private wrapper. Keep the cron job at a conservative hourly cadence to avoid excessive unauthenticated GitHub API requests. Check the log for `up_to_date`, `update_available`, `deployed`, or `error` results, and periodically inspect backup retention and health.

**Before enabling unattended deployment**, test a supervised upgrade and a failed-release/image-rollback drill. The existing health gate verifies the Docker container's health and commit revision, not Calendar OAuth, actual chore behavior, or reverse-proxy accessibility. Automated rollback only changes the image; incompatible database migrations still need manual restore. Failure logs should be reviewed; no automatic alerts are configured.

The script may leave Container Station's Applications metadata stale, as previously observed and accepted. Docker Compose and the persistent `active.compose.yml` remain authoritative. Do not edit Container Station's stored YAML or schedule a second deployer for the same service.
