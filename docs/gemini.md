# Gemini Assistant

This file contains information about the Gemini assistant's setup and configuration for this project.

## Testing

The project is set up with [Vitest](https://vitest.dev/) for unit testing the Nuxt application in the `frontend` directory.

- **Configuration**: `frontend/vitest.config.ts`
- **Test setup**: `frontend/tests/setup.ts` (mocks for `vuefire` and `firebase/firestore`)
- **Test command**: `npm test` in the `frontend` directory.

A list of tests to be added can be found in [tests-todo.md](./tests-todo.md).
