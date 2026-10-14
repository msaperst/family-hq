# Running Family HQ tests

Run commands from `family-hq/`. Use Node.js **22.22.2 or newer** (or a compatible Node 24.15+ release) for the current jsdom/CSS dependencies. Node 22.20 emits `EBADENGINE` warnings; installing a newer npm alone does not fix that. Node's `node:sqlite` experimental warning is expected with Node 22.

## Fast checks (no browser required)

```sh
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:coverage
npm run build
```

`npm run test:coverage` runs all Vitest unit and integration tests and writes the source coverage report. `npm run test:e2e:persistence` runs the existing container persistence smoke test (Docker required).

## Playwright: real browser + API + SQLite

Browser tests exercise React, Fastify, recurrence, and a fresh seeded SQLite database. **They do not modify your local household database**. Stop local development servers on ports 5173/3080 before running them.

The runner is currently pinned outside the app lockfile; install it after `npm ci`:

```sh
npm install --no-save --package-lock=false @playwright/test@1.56.1
```

### Supported Linux host

```sh
npx playwright install --with-deps chromium
npx playwright test
```

### Ubuntu 26.04 / unsupported Chromium host

Use the matching official Playwright container, which includes Chromium and its OS libraries:

```sh
docker run --rm --init --network host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v1.56.1-noble \
  bash -lc 'npm ci && npm install --no-save --package-lock=false @playwright/test@1.56.1 && npx playwright test'
```

Use `npx playwright test --headed` inside a graphical environment for a visible browser. The Docker command is headless by default.

Playwright initializes a new database under the OS temp directory, seeds children and daily/weekly/shared/overdue chores, then deletes the database. The browser suite uses a freshly seeded database per full run, with single-worker execution. Tests do not delete SQLite records between cases while the application server is running; doing so can cause SQLITE_BUSY lock errors. The suite tests column rendering, due dates, completion, reload persistence, future-chore expansion and cross-tab shared state. **Checkboxes update asynchronously**, and overdue chores disappear when completed; browser tests click and assert the resulting UI instead of requiring a checkbox to remain mounted.

CI runs the same Playwright suite in a separate **Playwright browser workflows** job and uploads screenshots/traces on failure. Browser tests do not contribute to Vitest's V8 unit-coverage percentage. A test failure should be diagnosed from its trace or screenshot, not bypassed.

## Useful individual runs

```sh
npm run test:unit -- --reporter=verbose
npm run test:integration -- --reporter=verbose
npx playwright test tests/e2e/browser/dashboard.spec.ts
npx playwright show-report
```

See `docs/API.md` for the API contract and `docs/RECURRENCE.md` for recurrence behavior.

If a Playwright failure still references `locator.check()` on `dashboard.spec.ts:28`, confirm you pulled the latest feature branch: the updated test uses `.click()` because completing overdue chores unmounts their checkbox. Run `grep -n '\.check()' tests/e2e/browser/dashboard.spec.ts` to confirm.

## Test isolation

Each Playwright test starts its own Fastify/Vite process on dynamically allocated loopback ports and initializes a new SQLite database under a uniquely named temporary directory. The test fixture stops the process and removes the database after the test. This means tests can run individually, in any order, or in parallel without sharing completion state. The seed is applied before the server starts; no SQL cleanup is attempted against a live database. Each test focuses on one observable behavior.
