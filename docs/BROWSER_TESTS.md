# Browser testing

Playwright tests exercise the actual React frontend, Fastify API, recurrence engine and SQLite persistence. They use a **new disposable database under the OS temporary directory** and never touch `family-hq/data/` or household records.

From `family-hq/`:

```sh
npm ci
npm install --no-save --package-lock=false @playwright/test@1.56.1
npx playwright install chromium
npx playwright test
```

The browser runner is installed separately from the app's production lockfile for this initial integration. CI uses the same pinned version and installs Linux browser dependencies with `--with-deps`. Browser tests are a separate required-check candidate from Vitest; they do not inflate unit-test coverage metrics.

The suite seeds Porter, Miller, daily and shared chores, a flexible weekly chore, and an overdue occurrence. Tests cover real page rendering, overdue completion, persistence across reload, the upcoming-chores expander and a shared chore across tabs. The test setup rejects paths without the `family-hq-playwright-` prefix and cleans up the database after execution.

The Playwright web server uses loopback ports 3080 (API) and 5173 (Vite); close any local dev servers using those ports before running tests.
