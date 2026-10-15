# Refactoring Workflow

1. Analyze the selected file or directory
2. Check for:
   - Manual imports that can be auto-imported.
   - Large components that should be split.
   - Prefer thin components and thick composables.
   - Hardcoded strings that should be in `nuxt.config.ts` or `.env`.
3. Propose a refactor plan.
