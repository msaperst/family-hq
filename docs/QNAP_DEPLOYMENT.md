# Production deployment

Family HQ is a self-hosted web application consisting of a React frontend, a Fastify API, and a SQLite database. This guide describes how to deploy it as a single Docker Compose application on a NAS or another Docker-capable Linux host.

## Architecture and security model

The production image serves both the frontend and the API on TCP port `3080` inside the container. SQLite is stored in a dedicated external Docker volume so application updates do not remove household data.

The provided [production Compose file](../compose.prod.yaml) publishes HTTP only to the **Docker host's loopback interface**. An HTTPS reverse proxy on the same host can forward to this listener. This is intentional: the application's chore and administration endpoints do not require accounts and must not be exposed directly to the public internet.

A suitable deployment therefore provides:

- Trusted-network access controlled by the host firewall and reverse proxy.
- An internal DNS name and trusted TLS certificate for browser access.
- A reverse proxy on the Docker host, forwarding HTTPS to `http://127.0.0.1:3080`.
- Persistent storage with a separately managed, consistent backup plan.

A reverse proxy running on **another host** cannot connect to the loopback-published port. That topology needs a separately secured network binding; do not change the published address to `0.0.0.0` without implementing equivalent ingress restrictions.

Application-level LAN checks are defense in depth. When requests arrive through a proxy, the application may see the proxy's private address instead of the browser's real IP. Do not rely on application source-IP checks alone to block external access. The current deployment is not an Alexa or remote-access endpoint; external integrations require an independently authenticated gateway.

## Prerequisites

- Docker Engine and Docker Compose with support for external volumes.
- A host able to build the application image (Node.js is supplied by the Docker build).
- An unused local TCP port (default `3080`).
- A same-host HTTPS reverse proxy, trusted certificate, private DNS resolution, and firewall rules for the intended users.
- A reliable filesystem for SQLite database locking and WAL operations.

The production Compose configuration is independent from [local development Compose](../compose.yaml). It is suitable for manual builds and deployments; automated image publishing and rollbacks are separate operational concerns.

## Configuration

Create a private environment file from the committed template:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

The following variables are read by Compose:

| Variable | Purpose |
| --- | --- |
| `FAMILY_HQ_PUBLISHED_PORT` | Loopback HTTP port on the Docker host; defaults to `3080` |
| `FAMILY_HQ_IMAGE` | Image name or tag to build and run; defaults to `family-hq:local` |
| `FAMILY_HQ_GOOGLE_CALENDAR_ID` | Calendar identifier for read-only events |
| `FAMILY_HQ_GOOGLE_CLIENT_ID` | OAuth client identifier |
| `FAMILY_HQ_GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `FAMILY_HQ_GOOGLE_REFRESH_TOKEN` | OAuth offline refresh token |

The four Calendar values must either all be set or all be omitted. Without them, chore functions remain available while the calendar API reports that it is not configured. Follow [Google Calendar setup](GOOGLE_CALENDAR.md) for the required read-only scope and token setup.

Keep `.env.production`, OAuth credentials, and any exported database snapshots outside source control. Protect the configuration file at the host level; environment variables are visible to operators with Docker administrative access.

## Prepare persistent storage

Create the external Docker volume once:

```sh
docker volume create family-hq-data
docker volume inspect family-hq-data
```

The Compose service mounts this volume at `/app/data`, with the database stored at `/app/data/family-hq.sqlite`. The application runs as an unprivileged user. Verify that the volume is writable by that user on the target platform.

Do not remove this volume during upgrades. In particular, `docker compose down -v` is inappropriate for a deployment containing data you want to retain.

## Build and start

From a checkout of this repository, with the private `.env.production` present:

```sh
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
docker compose --env-file .env.production -f compose.prod.yaml up --build -d
docker compose --env-file .env.production -f compose.prod.yaml ps
curl --fail http://127.0.0.1:3080/api/health
```

If the published port was changed, use that port for the health request. A healthy response indicates that the application started; it does not establish that Calendar credentials, TLS, or backup coverage are correct.

Review startup logs using `docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100`. Avoid sharing logs that might contain household records.

## Configure private HTTPS access

Configure the existing HTTPS reverse proxy with:

| Setting | Value |
| --- | --- |
| Public-facing protocol | HTTPS, restricted to the intended private network |
| Hostname | Your private application hostname |
| Backend protocol | HTTP |
| Backend host | `127.0.0.1` (same host as Docker) |
| Backend port | `FAMILY_HQ_PUBLISHED_PORT` (default `3080`) |
| TLS certificate | Trusted certificate matching the hostname |

Preserve the requested `Host` header so that same-origin browser mutations work. Apply network restrictions at the proxy/firewall, not just in Family HQ, and test them from an untrusted network. Configure private DNS to return the Docker host address for the application hostname; ensure that clients on each intended subnet can route to that host.

Do not assume that a trusted certificate or private DNS record makes a service private. Verify that no public forwarding, tunnel, or firewall rule exposes the application.

## Verify the deployment

Before relying on the service, verify the following:

1. The HTTPS site loads on intended household devices, with a valid certificate and no mixed-content errors.
2. Calendar events load when OAuth is configured, or fail without exposing credentials.
3. Chore completion and parent settings work through the reverse proxy and remain reflected across two clients.
4. A completed chore persists after a container recreation, not just a browser refresh or simple restart.
5. Requests from unauthorized networks cannot reach the dashboard or any API route.
6. The service recovers after a host restart, and the Docker health check reports healthy.

A useful recreation test is:

```sh
docker compose --env-file .env.production -f compose.prod.yaml up -d --force-recreate
```

Recheck the application, database integrity, and representative records afterward.

## Updates, backup, and recovery

To deploy a revised application manually, verify a consistent database backup first, review schema migration compatibility, build the new image, recreate the container, and re-run health and workflow checks. A Docker volume is **persistence, not backup**. SQLite in WAL mode must be backed up via a consistent snapshot rather than copying only the live database file.

See [SQLite persistence and restore](PERSISTENCE.md) for snapshot and restore procedures. The automated deployment and rollback process must also account for migrations that cannot safely be reversed by changing image tags alone.
