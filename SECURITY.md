# Security Policy

Family HQ is an early-stage self-hosted application (currently `0.x`). There is no separately supported stable release branch; security fixes are developed against `main`.

## Reporting vulnerabilities

Please **do not open a public issue containing exploit details, secrets, or household data**. Use GitHub's private vulnerability-reporting feature for this repository when available, or contact the repository maintainer privately through GitHub. Do not test against someone else's deployed household instance.

## Deployment security boundary

- The current application is intended for **trusted local networks only**. Chore mutations and parent administration deliberately do not require user logins; anyone with permitted LAN access can change household data.
- Do not publish the app/API through ordinary port forwarding, an unrestricted reverse proxy, or a publicly reachable Cloudflare Tunnel route.
- Enforce LAN-only reachability in the NAS host firewall and reverse proxy. Application source-IP filtering is defense in depth, not a substitute for proper ingress restrictions; reverse proxies may make external visitors appear to originate from a private container address.
- Use HTTPS on the LAN when practical. Keep OAuth secrets, refresh tokens, production databases, and other household records outside Git and CI artifacts.
- Any future Alexa or external service integration requires a **separate authenticated gateway and deliberately limited API**, not exposure of existing unauthenticated routes.

## Maintenance

Dependency audits, CodeQL, SonarCloud and container scans run in CI. A successful scan is not a guarantee against application-level vulnerabilities. Reported issues are triaged and patched according to severity and impact.
