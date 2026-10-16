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

## Updating and rollback

1. Record the currently deployed **image digest or full SHA tag** and verify SQLite is backed up before deploying an update.
2. Check GitHub Actions and GHCR for the newly published image. Change only the `image:` value in the Container Station application YAML and recreate/update the application.
3. Check container health, browser loading, and calendar and chore functionality. Confirm that the existing SQLite volume remains mounted.
4. On failure, restore the previous verified image tag and redeploy. **Important:** image rollback cannot reverse a database migration. If a release changes the schema incompatibly, restoring an image alone may not work: recovery must use a corresponding consistent SQLite snapshot.
5. Never use `docker compose down -v` or delete `family-hq-data` during upgrades.

The NAS-initiated polling, locking, health-check gating, approved release selection, and automatic rollback portion of issue #2 is intentionally deferred until this initial deployment is proven. GHCR publishing is not a NAS rollout.
