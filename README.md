# Family HQ

Self-hosted household dashboard. This initial skeleton provides a React page and a Fastify health endpoint. Chores, calendar integration, SQLite persistence and NAS deployment are separate issues.

## Requirements

Node.js 22 and npm. Docker Compose is optional for a container smoke test.

## Local development

From `family-hq/`:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies `/api` to Fastify at http://127.0.0.1:3000. Check the API directly with `curl http://127.0.0.1:3000/api/health`.

## Build and test

```sh
npm run typecheck
npm test
npm run build
NODE_ENV=production npm start
```

Production mode serves the built UI and API on http://127.0.0.1:3000. Stop either server with Ctrl+C.

## Docker smoke test

```sh
docker compose up --build -d
curl http://127.0.0.1:3000/api/health
docker compose down
```

Compose binds to localhost only. It is **not** a QNAP deployment configuration. NAS routing, TLS, SQLite persistence and backups are planned in later tickets. No secrets are required yet.

**Dependency lockfile:** not yet generated. Before merging this scaffold, run `npm install` with registry access and commit the resulting `package-lock.json`; switch Docker builds to `npm ci` for reproducibility. The PR should not be considered fully validated until typecheck, tests, build and Docker smoke test run.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Requirements](docs/REQUIREMENTS.md)
- [Development](docs/DEVELOPMENT.md)

## Tracking

[#3 App skeleton](https://github.com/msaperst/home-lab/issues/3) · [#4 CI/security](https://github.com/msaperst/home-lab/issues/4)
