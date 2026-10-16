# QNAP production deployment (issue #1)

**Status:** deployment configuration prepared; **not yet validated on the NAS**. This guide does not authorize a public internet endpoint or modifications to existing Minecraft, backup, DNS, or certificate services. Keep the local `compose.yaml` unchanged for tests.

## Architectural boundary

- The NAS runs one `family-hq` container. Its SQLite data is on an **external named Docker volume** and survives container/application recreation.
- Production Compose publishes HTTP only on the **NAS host loopback** at `127.0.0.1:3080`. This requires an HTTPS reverse proxy running on the **same NAS host** (or an equivalent local host proxy). A proxy on another machine cannot reach the loopback binding.
- Use an internal-only DNS hostname, internal TLS certificate, and a reverse proxy that exposes Family HQ to approved household networks only. Never port-forward, publish a Cloudflare Tunnel route, or proxy it to the public internet. Keep the unauthenticated parent API private.
- Verify that both monitored and upstream network clients can reach the chosen hostname through your actual routing/firewall setup. DNS resolution alone does not prove connectivity.
- Do not blindly trust forwarding headers; configure proxy ingress and firewall to prevent external clients being represented to Family HQ as a private Docker address.

## First deployment on Niaj

Run commands on the NAS with Docker/Compose available, using a private deployment directory containing the reviewed `compose.prod.yaml`, source build context, and `.env.production`. Docker build requires the full app source at this stage. Issue #2 will replace manual source builds with validated registry images using NAS-initiated polling (the existing Minecraft pattern).

1. Verify `docker compose version`, free host port 3080, storage capacity, and reverse-proxy capability.
2. Create **one** persistent volume (do not reuse the Minecraft volume):

   ```sh
   docker volume create family-hq-data
   docker volume inspect family-hq-data
   ```

3. Copy `.env.production.example` to a private `.env.production` on Niaj, with restrictive filesystem permissions. Supply all four Google Calendar variables for live calendar events; don't commit credentials or include them in logs.
4. Validate the manifest before starting:

   ```sh
   docker compose --env-file .env.production -f compose.prod.yaml config --quiet
   docker compose --env-file .env.production -f compose.prod.yaml up --build -d
   docker compose --env-file .env.production -f compose.prod.yaml ps
   curl --fail --silent http://127.0.0.1:3080/api/health
   ```

5. Configure the local reverse proxy for HTTPS with your existing internal certificate workflow. Ensure the proxy restricts client networks, denies external ingress, and forwards the original `Host` and `Origin` appropriately. Do not enable the hostname outside approved networks.
6. From both home subnets and the iPad, verify `https://<your-internal-hostname>/api/health`, load the dashboard, update a disposable chore, and verify calendar data without disclosing event details. Test an untrusted network: it must not reach the service.

**Note:** `/api/health` only verifies application startup, not Google connectivity or SQLite backup coverage. Verify real chore persistence after a container **recreation** (not simply restart), using `docker compose up -d --force-recreate`. Do **not** run `docker compose down -v` or remove `family-hq-data`.

## Deployment separation and rollback

Issue #1 establishes a manually verifiable runtime layout and HTTPS/LAN access. Issue #2 owns image publishing, checksum/version pinning, NAS polling, post-deploy verification, automatic rollback and migration compatibility. Do not introduce NAS inbound CI access or pretend the local build is an Actions-published image.

## Backups and secrets

An external named Docker volume does **not** establish backup protection. SQLite uses WAL; copying a live `.sqlite` file alone can produce inconsistent backups. Follow [persistence](PERSISTENCE.md), create a consistent snapshot (e.g. `VACUUM INTO`), verify integrity, then independently copy it into a location included in the backup plan. Backup automation and restoration drills belong in issue #3.

## Verification checklist

- [ ] NAS Docker/Compose support confirmed and no port collisions
- [ ] External volume survives container recreation; database integrity and chores verified
- [ ] Internal-only hostname resolves from both subnets
- [ ] Trusted TLS certificate presented for the internal hostname
- [ ] LAN-origin completion and parent-management flows work
- [ ] Requests from an untrusted network cannot reach any household API
- [ ] OAuth secrets never appear in browser responses, image layers, source control, or logs
- [ ] HTTPS proxy applies appropriate forwarding and ingress restrictions
- [ ] Backup coverage separately confirmed under issue #3

## Chosen internal hostname and preferred reverse proxy

Internal hostname: `family-hq.home.onemoresaperstone.com`, resolving locally to Niaj (`192.168.0.4`). Configure an Unbound host override in pfSense and ensure upstream-subnet devices use a resolver with the same override if they need this hostname; Cloudflare public DNS need not expose a private A record.

Prefer the **QTS 5.2 built-in reverse proxy**, subject to confirming NAS OS version and an available HTTPS listener port. In **Control Panel → Network & File Services → Network Access → Reverse Proxy**, configure an HTTPS source for the chosen hostname and an HTTP destination `127.0.0.1:3080`. Select a restrictive access-control profile permitting only `192.168.1.0/24` and `192.168.0.0/24`; verify QTS semantics and test with an unauthorized source before relying on them. Reuse the installed `*.home.onemoresaperstone.com` certificate after verifying that QTS itself presents it on the reverse-proxy listener (the existing stunnel synchronization alone is not proof of this).

**Preflight before changing QTS:** check whether QTS administration or another service already occupies TCP 443; do not alter management ports blindly. Also verify that proxying to `127.0.0.1` actually reaches the Docker-published loopback port. If no suitable same-host HTTPS listener is available, compare a dedicated proxy container or another host, adjusting the container bind/network architecture only through a separately reviewed change.

**Application-origin protections:** preserve the incoming `Host` header so legitimate same-origin chore updates work through the proxy. Validate browser calls, and keep remote-client source restrictions in QTS/firewall because the application may only see the proxy's loopback/private address.
