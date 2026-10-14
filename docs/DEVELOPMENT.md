# Family HQ development

## Workflow

Work in scoped feature branches and submit pull requests into `main`. Keep production code, tests and documentation together. Do not change the existing NAS backup/network infrastructure as part of an unrelated app change.

## Prerequisites

- Node.js 22 and npm
- Docker with Compose for container testing (optional locally)
- A free local TCP port (default `3080`; Grafana uses `3000` on the NAS)

## Environment configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Use |
| --- | --- | --- |
| `FAMILY_HQ_PORT` | `3080` | API listen port, Vite proxy destination, Compose port mapping and container health check |
| `HOST` | `127.0.0.1` | Local API bind address; Compose overrides to `0.0.0.0` inside container |
| `VITE_PORT` | `5173` | Local frontend development port |

Vite reads `.env` through `loadEnv`. Node does **not** automatically load `.env`; the development scripts load it using Node's `--env-file-if-exists` option. Compose reads the file for variable substitution. Never commit `.env` or credentials.

## Local development

From `family-hq/`:

```sh
cp .env.example .env
npm install
npm run dev
```

Open the frontend at `http://127.0.0.1:5173` (or the configured `VITE_PORT`). The page fetches `/api/health` via Vite's proxy to the configured `FAMILY_HQ_PORT`. To verify the API independently:

```sh
curl "http://127.0.0.1:${FAMILY_HQ_PORT:-3080}/api/health"
```

Stop with Ctrl+C. Development starts both processes using `concurrently`.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

To verify the compiled application:

```sh
NODE_ENV=production npm start
```

Open `http://127.0.0.1:3080` (or your configured port). The API and compiled UI are served by the same Fastify process.

## Docker smoke test

```sh
docker compose up --build -d
curl "http://127.0.0.1:${FAMILY_HQ_PORT:-3080}/api/health"
docker compose down
```

Compose binds the port to host loopback only. This is **not** the QNAP production deployment configuration.

## CI

The scoped `.github/workflows/family-hq.yml` runs on Family HQ changes. It performs TypeScript validation, Vitest tests, production build, npm dependency audit and Docker build/health smoke testing. It does not deploy or publish images. Additional lint, Playwright, security analysis and release automation are tracked in #4 and subsequent tickets.

**Lockfile follow-up:** The authoring environment could not access npm registry, so `package-lock.json` has not been generated. Before merging PR #20, run `npm install`, commit `package-lock.json`, replace `npm install` with `npm ci` in Docker and CI, and confirm checks pass. This is required for reproducible dependency resolution.

## Engineering expectations

Use deterministic tests and isolated fixtures. Never use real Google credentials in CI or modify the live chores spreadsheet. Tests belong in test jobs, not application startup. Add verified operational documentation when deployment and backup tickets are implemented.
