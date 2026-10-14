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

## Continuous integration and security checks

The workflow at `.github/workflows/family-hq.yml` runs for pull requests and pushes to `main` when Family HQ application files or its CI configuration change. Run the local verification commands above before pushing, especially in this private repository where GitHub Actions minutes are limited.

CI requires:
- **Source hygiene:** `npm run lint` checks line endings, trailing whitespace and indentation. It does not perform semantic JavaScript/TypeScript linting.
- **Type safety and tests:** TypeScript checks, Vitest coverage and the production build must pass.
- **Dependency security:** `npm audit --audit-level=high` rejects high/critical dependency advisories.
- **Runtime behavior:** The Docker smoke test checks the health endpoint, serves the built frontend and confirms unknown API routes return HTTP 404.
- **Code analysis:** SonarQube enforces its quality gate using `coverage/lcov.info`; CodeQL scans JavaScript/TypeScript sources.
- **Container security:** Trivy scans the production Docker image for fixable high/critical OS and library vulnerabilities. Keep the final image limited to files and executables needed to run the service.

### SonarQube configuration

Use `family-hq/sonar-project.properties` to configure sources, tests and coverage. The SonarCloud project key is `msaperst_home-lab` under organization `msaperst`.

Set the repository Actions secret `SONAR_TOKEN` to a SonarCloud analysis token. Configure the project quality gate and GitHub PR integration in SonarCloud. Keep tokens out of source control and example environment files.

### Required pull request checks

In GitHub repository branch protection or rulesets for `main`, require the relevant Family HQ checks, including the SonarQube quality gate, CodeQL and container vulnerability scan. Verify their exact reported check names before adding them. Do not merge when required checks fail; investigate findings rather than disabling the gates.

### Updating dependencies

Keep `package.json` and `package-lock.json` synchronized. Use `npm install` to update the manifest and lockfile, commit both, and run `npm ci` to verify reproducibility. CI and Docker intentionally install from the committed lockfile. Resolve audit findings before merging.

## Engineering expectations

Use deterministic tests and isolated fixtures. Never use real Google credentials in CI or modify the live chores spreadsheet. Tests belong in test jobs, not application startup. Add verified operational documentation when deployment and backup tickets are implemented.
