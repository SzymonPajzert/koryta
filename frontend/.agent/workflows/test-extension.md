# Test Extension Workflow

**Description**: A workflow designed to systematically analyze current test coverage and iteratively plan and implement new tests to improve codebase maintainability.

## Trigger
Use this workflow when the user requests to "extend test coverage", "analyze test coverage", or when instructed to improve testing for a specific module or component.

## Steps

### 1. Coverage Analysis
- Execute tests with coverage reporting enabled (e.g., `npm run test:ci -- --coverage` or similar Vitest coverage commands) to identify areas with missing tests.
- Alternatively, review a specific component/module and identify edge cases or branches that lack explicit coverage.

### 2. Iteration Planning (Scratchpad)
- Create or update a scratchpad file (e.g., `tests_to_implement.md` in the `.agent/scratch/` directory or root) to document your findings.
- Write down the specific files, lines, or scenarios that require testing.
- Prioritize the list (e.g., core business logic and critical user journeys first).

### 3. Execution (The TDD Loop)
- Pick an item from your iteration plan.
- **Strictly follow the TDD loop** as defined in `tdd.md`:
  1. Write the test (Vitest for units/components, Playwright for CUJs).
  2. Verify it fails (or captures the missing coverage).
  3. Update the code if it's a bug fix, or verify the test passes if it's pure coverage.
- Mark the item as completed in your scratchpad.

### 4. Rinse and Repeat
- Continue iterating through your scratchpad.
- Keep the user informed of your progress by reporting which coverage gaps have been closed.
