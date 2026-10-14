# Family HQ development

## Workflow

Work in scoped feature branches and submit pull requests into `main`. Keep production code, tests and documentation together. Do not change existing NAS backup/network infrastructure as part of an unrelated app change.

## Prerequisites

- Node.js 22 and npm
- Docker with Compose for container testing (optional locally)
- A free TCP port (default `3080`; Grafana uses `3000` on the NAS)

## Environment configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Use |
| --- | --- | --- |
| `FAMILY_HQ_PORT` | `3080` | API listen port, Vite proxy destination, Compose mapping and container health check |
| `HOST` | `127.0.0.1` | Local API bind address; Compose overrides to `0.0.0.0` inside container |
| `VITE_PORT` | `5173` | Local frontend development port |

Vite reads `.env` through `loadEnv`. The Node development script uses `--env-file-if-exists`. Compose reads the file for variable substitution. Never commit credentials.

## Local development

From `family-hq/`:

```sh
cp .env.example .env
npm ci
npm run dev
```

Open `http://127.0.0.1:5173` (or the configured `VITE_PORT`). Vite proxies `/api` to the configured `FAMILY_HQ_PORT`.

## Verification

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm audit --audit-level=high
```

The Vitest V8 coverage report is written to `coverage/lcov.info` and uploaded for SonarQube analysis.

For compiled application smoke testing:

```sh
NODE_ENV=production npm start
```

The server serves the built UI and API on the configured `FAMILY_HQ_PORT`. Stop with Ctrl+C.

## Docker smoke test

```sh
docker compose up --build -d
curl "http://127.0.0.1:${FAMILY_HQ_PORT:-3080}/api/health"
docker compose down
```

Compose binds to host loopback only and is not a QNAP production deployment.

## CI and SonarQube

The scoped `.github/workflows/family-hq.yml` runs on Family HQ PRs and pushes to `main` that affect the application or workflow. It performs typechecking, tests with coverage, production build, npm audit, Docker smoke test, **SonarQube scan and quality gate enforcement**. No image is deployed.

The scanner uses `family-hq/sonar-project.properties`, with `src/` as source, `tests/` as tests and `coverage/lcov.info` for JavaScript/TypeScript coverage. It targets the existing `msaperst` SonarCloud organization using the proposed project key `msaperst_home-lab`. Provision that project in SonarCloud, authorize GitHub repository integration/PR decoration, and configure a repository Actions secret named `SONAR_TOKEN` with an appropriate analysis token. Do not put tokens in `.env.example` or the repository.

After initial analysis, configure the SonarCloud quality gate for new code and require the GitHub Actions `SonarQube analysis and quality gate` check in branch protection. The workflow intentionally fails if scanning or the quality gate fails. For forked PRs, secrets may be unavailable; do not weaken token access or expose secrets to untrusted workflows to bypass this.

**Locked dependencies:** `package-lock.json` is committed. CI and Docker use `npm ci` so installs fail if the lockfile and manifest disagree. When updating dependencies intentionally, run `npm install` to update both `package.json` and `package-lock.json`, then commit both. Re-run all CI checks and resolve dependency audit findings before merging.

Issue #4 extends the workflow with scoped CodeQL JavaScript/TypeScript analysis and a blocking Trivy production-image vulnerability scan (fixable high/critical OS and library findings). A dependency-free source hygiene gate now checks source/test scripts for whitespace and newline consistency. The Docker smoke job also verifies that the built frontend is served and unknown API routes return 404. These are not substitutes for ESLint, Prettier or a real Playwright browser run: those remain to be added with properly updated locked dependencies. The new CodeQL and Trivy jobs should be added to required checks after they pass.

## Engineering expectations

Use deterministic tests and isolated fixtures. Never use real Google credentials in CI or modify the live chores spreadsheet. Tests belong in test jobs, not application startup. Add verified operational documentation when deployment and backup tickets are implemented.
