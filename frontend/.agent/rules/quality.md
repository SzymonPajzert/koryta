# Quality Assurance Rules

1. Prefer communication
   Whenever you're unsure about a big design decision, you can ask for clarification.
1. Clean changes
   Before modifying files at the beginning of your run, initialize a new change using jj:
   `jj new -m 'Description of the change'`

   You are free to pick a short description based on the prompt from the user.
   Do not use the feat: style: format. Just a normal description of the feature.

1. Test driven development

   For each change add vitest tests and e2e tests in the cypress directory if feasible.
   If user is asking to resolve an existing problem, first create those tests and run them,
   to make sure the test catches them and fails.

1. **Self-Correction**: Before finishing the run perform the following steps:
   - `npm run quick-check` to identify any issues. If there are some, address them first.
   - After it passes run e2e tests using `npm run test:e2e`.

1. **Failure Protocol**:
   - If the checks fail, do NOT ask for review. Analyze the error, fix the code, and re-run the tests.
   - Only request review once tests pass.

1. **Nuxt Specifics**:
   - Always use `<script setup lang="ts">`.
   - Rely on Nuxt auto-imports; do not manually import Vue/Nuxt composables unless necessary.

1. Allow modifications
   You can modify those rules, especially if I ask you to do something and it seems like a good thing to keep in mind.
