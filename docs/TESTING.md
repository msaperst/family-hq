# Test layers

- `npm run test:unit`: fast model and database tests.
- `npm run test:integration`: Fastify request/response contract tests using `inject()`. These do not open a network port. Chore endpoint tests belong here when #8 introduces the routes.
- `npm test`: unit and integration tests together.
- `npm run test:e2e:persistence`: Docker lifecycle test using a uniquely named disposable volume. Builds an image, initializes SQLite, writes a probe record, recreates the container, checks that the record survives and validates database integrity, then cleans up its container and volume.
- Browser Playwright flows start when #9 introduces the touchscreen interface.

The Docker test requires a working Docker daemon. It does not touch the regular Family HQ Compose project or any existing NAS volume. It can be run locally or by the CI Docker smoke job. The current API only exposes health; no chore API is implemented yet.
