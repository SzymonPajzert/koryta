# Quality Assurance Rules

1. Good practices
   - Follow complete Nuxt UI guidelines from https://ui.nuxt.com/llms-full.txt
   - Always use `<script setup lang="ts">`.
   - Rely on Nuxt auto-imports; do not manually import Vue/Nuxt composables unless necessary.

1. **Self-Correction**: Before finishing the run perform the following steps:
   - `npm run quick-check` to identify any issues. If there are some, address them first.
   - After it passes run e2e tests using `npm run test:e2e`.
   - specific E2E testing patterns are documented in `.agent/skills/e2e-testing.md`.

1. **Changelog for QA**:
   Every change a user can see gets an entry at the top of `shared/qa.ts`, in
   the same commit as the change. Entries carry no date - the order of the array
   is what says which is newest, so prepend, and after a rebase move yours back
   to the top. The entry says what changed and what to click to see it - `/qa` is where contributors work through that list and report
   what is broken, each on their own (one person's verdict does not check the
   entry off for anybody else). An `id` is never renamed or reused: it is what
   somebody's stored verdict points at, and what a report written there links
   back to - a verdict with anything written on it is forwarded to Slack and
   `/admin/opinie` like any other piece of feedback. If the change answers a
   report from `/admin/opinie`, list the report's id in the entry's `fixes`:
   the report then shows the entry and what its checkers found.

1. **Domain Knowledge**:
   - For working with Revisions and Edges, verify `.agent/skills/revisions.md`.
   - Before changing anything that lists a node's relations, read
     `.agent/skills/relation-surfaces.md`. There are five such surfaces sharing
     three helpers, and `/eksploruj/nowe` and `/eksploruj/tabela` are kept in
     parity on purpose - a capability added to one belongs on the other, in its
     own shape.
