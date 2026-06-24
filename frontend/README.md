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

Run tests through

```bash
npx cypress run
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
| `npm run test:playwright`     | Run Playwright tests                                    |
| `npm run backstop:approve`    | Approve BackstopJS visual test baseline                 |
