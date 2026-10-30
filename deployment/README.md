# Family HQ — GHCR image deployment

This is the image-only QNAP Container Station deployment path. GitHub builds an amd64 Docker image on `main` only after typechecking, tests, Playwright, Sonar quality gate, Docker smoke, and vulnerability scan succeed. No GitHub workflow connects to the NAS, and **publishing never automatically deploys** an image.

## Image release

A successful `main` workflow publishes:

`ghcr.io/msaperst/family-hq:sha-<full-40-character-commit-sha>`

The tag records the code revision. Use a tag tied to a known passing workflow; for stronger image pinning use the image's `@sha256:...` digest after it is published. We intentionally do not deploy from `latest`.

Check the repository's Actions run and GHCR package visibility first. A public repository does **not** guarantee its GHCR package is public. Either make this image package public in GitHub package settings (preferred for this LAN-only application with no embedded secrets) or configure read-only GHCR access on the NAS. Do **not** place a registry token in committed YAML.

## Integrated voice bridge rollout (manual Container Station change)

The Family HQ dashboard and AWS MQTT voice bridge are **two containers in one
Container Station application**, not two NAS applications. GitHub Actions tests
and scans the bridge image, publishing
`ghcr.io/msaperst/family-hq-voice-agent:sha-<full-40-character-commit-sha>`
**before** the corresponding Family HQ image. Both images use amd64 and
must be pinned to the **same verified main-branch commit** for the initial
combined rollout. Neither image is deployed automatically by GitHub Actions.

After merging, confirm the main workflow published **both** images and the
NAS can pull the new GHCR package. A public GitHub repository does not make
every GHCR package publicly accessible; enable package visibility separately
or use private read-only registry access. Complete AWS IoT Core Thing,
certificate, and least-privilege IoT policy setup first.

The private files already created on Niaj are:
- `/share/homes/msaperst/family-hq-voice/certs/device.pem.crt`
- `/share/homes/msaperst/family-hq-voice/certs/device.pem.key`

Keep the directory owned by UID 10001 with mode 0700 and each file mode 0600.
With `sudo`, specify both exact paths: shell wildcards cannot expand inside
a 0700 directory owned by that UID. Never commit or paste private keys.

Back up the current Container Station application definition and verify the
latest SQLite backup. In the **existing** `family-hq` application's YAML,
preserve the existing Family HQ service completely: env_file, loopback port,
persistent `family-hq-data` volume and healthcheck. Add the `voice-agent`
service from `container-station.compose.yaml`. Replace **both** image SHA
placeholders with the same verified commit. Confirm QNAP supports long-form
`depends_on`, `read_only`, and `tmpfs` before applying; use the normal
Container Station application update, not a second application. Do not use
`docker compose down -v` or remove existing Docker volumes.

The sidecar has no published ports and calls `http://family-hq:3080` on the
shared Compose network. It reports unhealthy while AWS MQTT is disconnected
but retries; **AWS downtime must not stop the dashboard**. A Family HQ API
outage returns a generic error to the bridge and is recoverable without a
restart. Verify Container Station health and a fresh MQTT `ping` in AWS
IoT Core before configuring Lambda, DynamoDB, or the Alexa skill.

**Existing NAS auto-updater:** `deploy_cli.py` still stages only the
Family HQ image and invokes `docker compose up -d --no-deps ... family-hq`,
preserving the bridge image tag. As previously documented, CLI takeover can
make the application disappear from Container Station's Applications list;
do not alternate UI and CLI deployments without reconciling the saved Compose.
Voice-image upgrades presently require an explicit Compose change and are
not part of the scheduled Family HQ updater.

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

### Failed-release quarantine

If an attempted deployment fails (including when image rollback also fails), scheduled polling writes `failed-release.json` to the private deployment state directory. Later `--apply` polls skip that same SHA with `status: quarantined`, avoiding repeated downtime each hour. A newly verified release with a different SHA is eligible normally. Temporary release-discovery problems or backup/preflight failures do **not** quarantine a release, so correctable infrastructure errors can be retried.

Review the deployment failure logs and database state before resetting quarantine. To explicitly retry a quarantined SHA, first disable automated deployment in the private cron wrapper (`AUTO_DEPLOY=no`), inspect the release and recovery plan, then remove **only** `failed-release.json` from the private deployment state directory. Do not remove `active.compose.yml`, `.deploy.lock`, snapshots, or application data. Enable deployment again only when appropriate.

The quarantine file survives NAS restarts because the state directory is persistent. This safeguards retry storms, not failures that occur after a fully healthy but functionally incorrect rollout. Verify Calendar, chores, and the HTTPS frontend separately; image rollback does not restore database contents.
