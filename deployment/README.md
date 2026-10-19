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

## Supported deployment: operator-approved Container Station update

GitHub Actions publishes an immutable commit-SHA image after successful gates. On the NAS, use [the read-only release checker](RELEASE_DISCOVERY.md) to identify the currently running revision and the newest verified published tag. **Image publishing and release checking never deploy.**

1. Confirm the application is healthy and write down the current *full* image tag and the intended new *full* tag. Check the release's database-migration compatibility before proceeding.
2. Run a fresh NAS-local online SQLite backup using [the documented backup command](../docs/LOCAL_SQLITE_BACKUP.md), and explicitly verify the resulting snapshot (`VERIFY_OK`). Do not deploy if either operation fails. Keep its exact filename available for recovery.
3. In **Container Station → Applications → family-hq → Recreate**, replace **only** the `image:` SHA tag with the verified target. Use **Validate → Update**. Do not change ports, `env_file`, environment variables, security options, or the external `family-hq-data` volume.
4. Confirm the container is running and **healthy**, check `http://127.0.0.1:3080/api/health` locally on the NAS, and test the HTTPS dashboard, Calendar and a representative chore interaction. Confirm the running image revision and Container Station's saved image tag both match the intended release.
5. If the update fails, use **Container Station → Recreate → Validate → Update** with the recorded previous image tag. Recheck container health and representative records. **Image rollback does not undo schema/data migrations**; if incompatible, stop the application and follow the verified SQLite restore procedure in the backup guide. Retain the pre-update snapshot until recovery is no longer needed.

**Never** use `docker compose up` with a staged/temporary Compose file against the Container Station application. A NAS experiment demonstrated that such an update changed Docker's Compose ownership labels and the test application disappeared from Container Station's Applications view; reverting those labels did not make it reappear. Container Station's UI-managed recreate is the supported update path. Do not edit QNAP-managed Compose files directly or run `docker compose down -v`.

This workflow is deliberately **manual**, not unattended deployment, monitoring, or automatic rollback. That is the adopted operating scope; enabling automation would require a separately validated Container Station-aware integration and explicit approval.

