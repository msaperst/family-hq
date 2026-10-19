# Container Station deployment preflight

This tool validates a proposed Family HQ release **without deploying it**. It is a prerequisite for a future, separately reviewed deployment controller. It does not pull images, stop or recreate containers, write to QNAP-managed files, or touch SQLite.

## Requirements

- Running and healthy Family HQ Docker Compose container, named `family-hq-family-hq-1`.
- Existing Container Station application Compose and resource YAML, as reported by Docker inspect.
- Outbound access to the public GitHub Actions API.
- Python 3 and Docker with explicit executable paths on the NAS.

## Run

Use the image SHA reported by `deployment/check_release.py`. Pass its *full* 40-character SHA. Obtain the application directory from the running container's Compose labels rather than guessing where QNAP stores files:

```sh
CONTAINER=family-hq-family-hq-1
APP_DIR="$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
DOCKER="$(command -v docker)"
PYTHON="$(command -v python3)"
TARGET_SHA=<full-40-character-SHA-of-newest-verified-release>

"$PYTHON" /path/to/family-hq-deployment/deployment_preflight.py \
  --docker "$DOCKER" \
  --compose "$APP_DIR/docker-compose.yml" \
  --resource "$APP_DIR/docker-compose.resource.yml" \
  --target-sha "$TARGET_SHA"
```

If the application files require elevated permissions, run the script with sufficient access; don't relax file permissions to make the test pass.

The output is a JSON report with the running revision, proposed image, Compose validation result, and `deployment_performed: false`. A nonzero exit means the preflight refused the proposed deployment; don't proceed until the mismatch is understood.

## Safety checks

The checker refuses to continue unless:

1. The running container belongs to the expected Family HQ Compose project/service and is healthy.
2. The running image has a full revision SHA.
3. The requested target matches the latest successful published `main` release verified by the GHCR publishing job.
4. The supplied Compose files exactly match the paths recorded in the container's ownership labels.
5. The saved image reference matches the currently running revision.
6. A candidate manifest with **only the image reference changed** passes `docker compose config --quiet` using the original resource configuration.
7. The original manifest has not changed during the validation.

Staging uses a temporary directory, not Container Station's managed application directory. **Passing this validation does not establish that a CLI deployment will keep Container Station synchronized.**

## Next phase

Until a supported update mechanism is validated, continue using **Container Station → Applications → Recreate** for manual updates and rollback. A future rollout component must separately perform and verify a predeployment SQLite snapshot, control the update and rollback, prove Container Station remains authoritative, and require explicit approval before unattended operation.
