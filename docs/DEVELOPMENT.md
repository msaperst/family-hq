# Family HQ development conventions

**Status:** policy agreed; commands and workflows will be added when implemented in [#3](https://github.com/msaperst/home-lab/issues/3) and [#4](https://github.com/msaperst/home-lab/issues/4).

## Branch and pull request policy

- `main` is the integration branch; do not push implementation directly to it.
- Use a scoped feature branch for each issue and open a PR targeting `main`.
- Keep changes focused; separate refactors and unrelated infrastructure changes.
- Link the tracking issue in the PR and describe the change, tests, risks and operational impact.
- Merge only after applicable checks pass and the change is reviewed.
- Update documentation and tests with the code they describe.

This mirrors the disciplined Saperstone Studios workflow without introducing an unnecessary `develop` branch.

## Proposed repository layout

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
    integration/
    e2e/
  migrations/
  Dockerfile
  compose.yaml
  package.json
.github/
  workflows/
    family-hq.yml
```

Only documentation exists initially. File names and internal source layout can be refined in #3 as long as boundaries remain clear.

## Quality gates

- Formatting, lint and strict TypeScript checks.
- Vitest unit tests for pure chore scheduling, rotation and completion behavior.
- API/integration tests against an isolated temporary SQLite database; validate migrations and persistence.
- Playwright browser tests for core interactions and accessible touchscreen controls.
- Dependency auditing, CodeQL where supported, and container image scanning.
- Publish test results and coverage artifacts in GitHub Actions.
- Ensure GitHub required-check configuration matches actual workflow job names.

Prefer deterministic fixtures and mocks. Never require real Google credentials or mutate a live Google Sheet in CI.

## Local development

#3 must document prerequisites, environment variables, installation, database setup, startup, test and cleanup commands after those commands have been validated. Do not invent commands here before an application exists.

Use `.env.example` for non-secret configuration examples and ignore actual secrets and SQLite data files. Keep Docker runtime concerns separate from test orchestration.

## CI and deployment separation

Pull requests validate code and buildability; a successful PR does not imply automatic production deployment. Publishing a versioned image and deploying it to QNAP are separate operations. Prefer pinned image versions, limited credentials and a documented rollback path.

## Definition of done for implementation tickets

- Requested behavior is implemented without unrelated changes.
- Appropriate automated tests pass locally and in CI.
- Security, data migration and backup implications are considered.
- Documentation reflects verified behavior, not aspirational commands.
- PR references the issue and records validation steps.

## Documentation lifecycle

- This file owns developer workflow conventions.
- [Architecture](ARCHITECTURE.md) owns technical decisions and security boundaries.
- [Requirements](REQUIREMENTS.md) owns user-visible behavior and MVP scope.
- GitHub issues own work status and acceptance for individual changes.
- Add `OPERATIONS.md` with tested deployment/backup/restore instructions during #13–#15.
