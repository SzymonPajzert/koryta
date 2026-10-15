---
name: refactor
description: Analyze a file or directory for refactors (imports Nuxt auto-imports, components to split, thin components and thick composables, hardcoded strings that belong in nuxt.config.ts or .env) and propose a plan.
disable-model-invocation: true
---

# Refactoring Workflow

1. Analyze the selected file or directory
2. Check for:
   - Manual imports that can be auto-imported.
   - Large components that should be split.
   - Prefer thin components and thick composables.
   - Hardcoded strings that should be in `nuxt.config.ts` or `.env`.
3. Propose a refactor plan.
