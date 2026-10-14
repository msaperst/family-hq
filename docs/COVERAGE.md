# Test coverage

Run `npm run test:coverage` from `family-hq/`. Vitest's V8 coverage provider reports all application files under `src/`, including source files that no test imports. Only TypeScript declaration files (`*.d.ts`) are excluded.

The explicit source glob is the **coverage universe**, not a per-feature allowlist. New modules under `src/` are included automatically. Do not add individual production files to the exclusions just to improve a metric. Test fixtures, compiled output, dependencies, and tooling live outside `src/`.

Review statements, branches, functions, and lines together. In particular, add tests for error handling, invalid input, database rollback, and date boundaries rather than ignoring uncovered conditions.

To check that a new source module is counted, run `npm run test:coverage` and look for its path in the per-file report. If it does not appear, review the Vitest configuration in `vite.config.ts` before merging.
