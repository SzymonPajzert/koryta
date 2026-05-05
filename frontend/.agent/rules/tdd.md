# Test-Driven Development (TDD) Workflow

As an AI agent working on this codebase, you MUST adhere to a Test-Driven Development (TDD) loop whenever you are asked to implement a new feature, modify existing business logic, or fix a bug. 

## The TDD Loop

1. **Red**: Start by writing a failing test *before* implementing any application code.
2. **Verify Failure**: Ensure the test fails exactly because the feature does not exist or the bug is present (run the test to confirm it's not a false positive).
3. **Green**: Write the minimal application code necessary to make the test pass.
4. **Refactor**: Clean up the implementation and the tests, ensuring the test remains green.

## Scope & Tool Selection

When deciding how to test a new feature, select the testing tool based on the scope and size of the issue:

### 1. Vitest + `@nuxt/test-utils` (Default)
Use Vitest natively for the vast majority of cases:
- Server API routes (`server/api/**`)
- Pinia stores and Vue composables
- Utility functions and pure logic
- Individual Vue components

### 2. Playwright (New CUJs)
Use Playwright for new Critical User Journeys (CUJs) or when the feature is heavily visual, UI-driven, or requires full browser interaction:
- Complex multi-page flows
- Critical interactions that depend on full browser rendering/layout (e.g., canvas, D3 graphs, drag-and-drop)
- Replacing legacy Cypress tests during a refactor.

*Note: Cypress is deprecated for new features. We are actively migrating to Playwright.*
