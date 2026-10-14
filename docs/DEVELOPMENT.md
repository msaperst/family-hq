# Family HQ development conventions

**Status:** app skeleton proposed in [#3](https://github.com/msaperst/home-lab/issues/3); full CI gates follow in [#4](https://github.com/msaperst/home-lab/issues/4).

## Branch and pull request policy

- `main` is the integration branch; do not push implementation directly to it.
- Use a scoped feature branch for each issue and open a PR targeting `main`.
- Keep changes focused; separate refactors and unrelated infrastructure changes.
- Link the tracking issue in the PR and describe the change, tests, risks and operational impact.
- Merge only after applicable checks pass and the change is reviewed.
- Update documentation and tests with the code they describe.

This mirrors Saperstone Studios without introducing a `develop` branch.

## Repository layout

```text
family-hq/
  README.md
  docs/
    ARCHITECTURE.md
    REQUIREMENTS.md
    DEVELOPMENT.md
  src/
    client/
    server/
    shared/
  tests/
    unit/
  Dockerfile
  compose.yaml
  package.json
.github/
  workflows/  # Family HQ CI follows in #4
```

## Local development

Prerequisites: Node.js 22, npm. From `family-hq/`:

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
NODE_ENV=production npm start
```

Development UI: http://127.0.0.1:5173; API: http://127.0.0.1:3000/api/health. See [README](../README.md) for Docker smoke test and shutdown. No database migration or secret setup is required for the skeleton.

The initial PR needs an npm lockfile and verification in an environment with npm registry access before merge. Once a lockfile is committed, use `npm ci` in CI and Docker builds.

## Quality gates (to implement in #4)

- Formatting, lint and strict TypeScript checks.
- Vitest unit tests for scheduling, rotation and completion.
- API/integration tests against isolated temporary SQLite; validate migrations and persistence.
- Playwright browser tests for touch controls.
- Dependency audit, CodeQL and container scanning where supported.
- Test reports, coverage and required-check alignment.

Prefer deterministic fixtures and mocks. Never use real Google credentials or mutate the live Google Sheet in CI.

## CI and deployment separation

PRs validate code and buildability; a successful PR does not deploy to QNAP. Publishing a versioned image and deploying it are separate operations. Prefer pinned versions, limited credentials and rollback.

## Definition of done

- Requested behavior is implemented without unrelated changes.
- Appropriate automated tests pass locally and in CI.
- Security, data migration and backup implications are considered.
- Documentation reflects verified behavior.
- PR references the issue and records validation steps.

## Documentation lifecycle

- This file owns development workflow.
- [Architecture](ARCHITECTURE.md) owns design/security decisions.
- [Requirements](REQUIREMENTS.md) owns user-visible behavior.
- GitHub issues own individual work status.
- Add `OPERATIONS.md` during #13–#15.
