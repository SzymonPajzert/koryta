# NUXT server documentation

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

To start, run:

```bash
# set up
npm install

# It initiates the emulators, seeds the data and creates an endpoint.
npm run dev:local
```

Then access Firebase emulated at hosting at `localhost:5002` and application at http://127.0.0.1:3000/

To start with production data:

```bash
# login to cloud
gcloud auth login

# pull data (remember to ask for permissions, otherwise 403)
npm run db:pull

# It initiates the emulators and the application
npm run dev:prod-data
```

## Testing

### Unit tests (Vitest)

```bash
npm run test:ci
```

### Playwright E2E tests

Playwright tests are the primary E2E test suite. They use the `webServer` config in
`playwright.config.ts` to automatically start emulators, seed data, and launch the dev server.

**CI mode** (seeded emulator data — used in GitHub Actions and `quick-check`):

```bash
npm run test:playwright:ci
```

**Local mode** (production-exported data — useful for testing with real data):

```bash
# First, pull production data if you haven't already
npm run db:pull

npm run test:playwright
```

**With an already-running dev server** (skips automatic server startup):

```bash
# Start your preferred dev environment in one terminal
npm run dev:local    # or: npm run dev:prod-data

# Run tests in another terminal — Playwright will reuse the existing server on :3000
npx playwright test
```

You can override which server command Playwright uses via the `PLAYWRIGHT_SERVER_COMMAND`
environment variable:

```bash
PLAYWRIGHT_SERVER_COMMAND="npm run dev:prod-data" npx playwright test
```

### Cypress E2E tests

```bash
npm run test:e2e        # run with seeded data
npm run test:e2e:prod   # run prod-specific tests
npm run test:e2e:open   # open Cypress UI
```

## Code quality

### Formatting

```bash
# format all files
npx prettier --write .

# check formatting without writing
npx prettier --check .
```

### Linting & duplication

```bash
# lint
npx eslint

# check code duplication in app/ and server/
npm run check:duplication
```

### Type checking

```bash
npm run typecheck
```

### Quick check (format + lint + types + tests)

```bash
# stops on first failure
npm run quick-check

# runs all checks regardless of failures
npm run quick-check:failsafe
```

## Scripts reference

| Script                        | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `npm run dev:local`           | Start emulators, seed data, and run dev server          |
| `npm run dev:prod-data`       | Start emulators with production data and run dev server |
| `npm run dev:build`           | Build and preview with emulators                        |
| `npm run build`               | Production build                                        |
| `npm run generate`            | Static site generation                                  |
| `npm run preview`             | Preview production build                                |
| `npm run emulators`           | Start Firebase emulators only                           |
| `npm run emulators:prod-data` | Start Firebase emulators with production data           |
| `npm run seed`                | Seed the emulator database                              |
| `npm run db:pull`             | Pull production data locally                            |
| `npm run stop`                | Kill all dev-related ports                              |
| `npm run test:ci`             | Run unit tests (Vitest)                                 |
| `npm run test:e2e`            | Run Cypress e2e tests                                   |
| `npm run test:e2e:prod`       | Run Cypress prod e2e tests                              |
| `npm run test:e2e:open`       | Open Cypress UI                                         |
| `npm run test:visual`         | Run BackstopJS visual regression tests                  |
| `npm run test:playwright`     | Run Playwright tests (production data)                  |
| `npm run test:playwright:ci`  | Run Playwright tests (seeded data, used in CI)          |
| `npm run quick-check`         | Format + lint + types + tests + Playwright              |
| `npm run backstop:approve`    | Approve BackstopJS visual test baseline                 |
