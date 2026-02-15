# Quality Assurance Rules

1. Good practices
   - Follow complete Nuxt UI guidelines from https://ui.nuxt.com/llms-full.txt
   - Always use `<script setup lang="ts">`.
   - Rely on Nuxt auto-imports; do not manually import Vue/Nuxt composables unless necessary.

1. **Self-Correction**: Before finishing the run perform the following steps:
   - `npm run quick-check` to identify any issues. If there are some, address them first.
   - After it passes run e2e tests using `npm run test:e2e`.
   - specific E2E testing patterns are documented in `.agent/skills/e2e-testing.md`.

1. **Domain Knowledge**:
   - For working with Revisions and Edges, verify `.agent/skills/revisions.md`.
