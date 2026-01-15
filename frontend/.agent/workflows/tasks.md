1. Testing Infrastructure (High Priority)
   - Unified VueFire/Auth Mocking: We struggled with [Vue warn]: injection "Symbol(VueFireAuth)" not found in OmniSearch.test.ts.
     Currently, we are using ad-hoc vi.stubGlobal calls in each test file.
     Improvement: Create a dedicated tests/setup/mockAuth.ts utility that provides a robust, reusable mock for useAuthState and the VueFire plugin. This would eliminate the boilerplate and ensure consistent behavior across all component tests.

   - Un-skip OmniSearch Test: The test "redirects to place for 'rect' nodes" is currently skipped because of difficulty spying on the router within the component's setup context.
     Improvement: Refactor the search logic out of the UI component into a pure composable (e.g., useOmniSearchLogic). This would allow us to test the redirection logic in isolation (unit test) without needing to mount the full component.

2. Refactoring & Architecture
   - Route Path Centralization: We have logic constructing paths like /entity/${type}/${id} scattered across OmniSearch.vue, EntityDetailsCard.vue, useNodeEdit.ts, and tests.
     Improvement: Create a centralized helper (e.g., getLinkForEntity(type, id)) in shared/routes.ts or a similar utils file. This prevents broken links if the URL structure changes in the future.

   - useNodeEdit Complexity: The useNodeEdit
     composable handles fetching, state management, saving, edge processing, and revisions. It's becoming a "God Object."
     Improvement: Split this into smaller, focused composables like useNodePersistence (save/load), useNodeRevisions (history), and useNodeEdges. This will make the tests for each part much simpler and faster.

3. Type Safety
   - Component Internals in Tests: In our tests, we had to use // @ts-expect-error to access vm.nodeGroupPicked.
     Improvement: If internal state needs to be tested, it’s often a sign that the logic should be extracted (as mentioned above) or that we should be testing user interactions (clicking items) rather than internal state. Improving the component implementation to be more "black-box" testable would be better.

4. E2E Stability
   - Entity Picker & window.open: The E2E failure in entity_picker_workflow.cy.ts highlights that testing window.open behavior is flaky and brittle.
     Improvement: Consider replacing the window.open "quick add" workflow with an in-app modal or execution flow. This provides a better user experience (no popup blockers) and is much easier to test reliably.

5. Smaller tasks

- Fix too narrow cards on the list view on emulated server. They are very very narrow.
- Cypress tests are duplicated. Decide if they should be merged.

6.  Replace percySnapshots

- rename command to something generic, e.g. snapshot("page name"), still taking the argument.
- I ran out of quota on percySnapshots, so use another solution, e.g. checking in the screenshots and checking their diff.
- Add snapshot in cypress tests to increase the coverage
- also decrease their total number so we don't run out of quota.

7. Component unification

- Enter plan mode.
- Analyze components and outline what they're used for.
- Propose unification for some of them
