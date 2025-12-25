# Local Development Setup

This guide explains how to set up the local development environment for the Koryta frontend, including Nuxt, Firebase Emulators, and testing tools.

## Prerequisites

- **Node.js**: v18 or later
- **Java**: Required for Firebase Emulators (JRE 11 or later recommended)

## Installation

1.  Install dependencies:
    ```bash
    npm install
    ```

## Local Development

To run the application locally with a full Firebase Emulator suite (Auth, Firestore, Realtime Database, Functions):

```bash
npm run dev:local
```

This command runs `concurrently`:

1.  **Firebase Emulators**: Starts emulators and imports data from `../database/current_firestore`.
2.  **Nuxt Dev Server**: Starts the frontend application.

- **Frontend**: http://localhost:3000
- **Emulator UI**: http://localhost:4000

### Database Seeding

The emulators automatically import data from `../database/current_firestore` on startup. This ensures you always have a consistent dataset for development.

## Testing

### Unit Tests (Vitest)

Run unit tests with Vitest:

```bash
npm run test
```

### End-to-End Tests (Cypress)

Run E2E tests with Cypress:

```bash
npm run test:e2e
```

This opens the Cypress interactive runner. Ensure the local development server (`npm run dev:local`) is running before starting Cypress.

## CI/CD & Pull Requests

We use GitHub Actions for continuous integration.

### Automated Checks

Every Pull Request triggers:

- **Linting**: Ensures code style consistency.
- **Unit Tests**: Runs Vitest.
- **E2E Tests**: Runs Cypress tests against the emulators.
- **Visual Regression**: Runs Percy to detect UI changes.

### Preview Deployments

A temporary **Preview URL** (e.g., `https://pr-123--koryta-pl.web.app`) is automatically generated for every PR. Use this to review UI changes on a live environment.
