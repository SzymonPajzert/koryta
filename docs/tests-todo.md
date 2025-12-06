# Tests to be added

This file contains a list of tests that should be added to the project with [[vitest]]
- ## Frontend
- ### Mocking data
	- For unit tests, a better approach is to mock the data directly in your tests. This provides better isolation and
	  control. You can extend the mocks in frontend/tests/setup.ts.
	  
	  Here is an example of how you can modify frontend/tests/setup.ts to return mock data from useCollection:
	  
	  ```
	  // frontend/tests/setup.ts
	  import { vi } from 'vitest'
	  import { ref } from 'vue'
	  
	  const mockNodes = [
	  { id: '1', type: 'person', name: 'John Doe', parties: ['PO'] },
	  { id: '2', type: 'person', name: 'Jane Smith', parties: ['PiS'] },
	  ]
	  
	  vi.mock('vuefire', () => ({
	   useFirestore: vi.fn(() => ({})),
	   useCollection: vi.fn((query) => {
	     // This is a very basic mock. A more advanced mock could inspect the query constraints.
	     // For the 'nodes' collection, we return some mock data.
	     // Based on your `entity.ts` store, the path is hardcoded to 'nodes'.
	     return ref(mockNodes)
	   }),
	  }));
	  
	  vi.mock('firebase/firestore', async (importOriginal) => {
	   const actual = await importOriginal()
	   return {
	     ...actual,
	     collection: vi.fn((db, path) => ({ path })), // Return a mock collection reference with the path
	     query: vi.fn((q) => q), // return the query object itself
	     where: vi.fn(),
	   }
	  })
	  
	  vi.mock('nuxt-vuefire', () => ({
	   useCurrentUser: vi.fn(),
	  }));
	  ```
	  
	  This mock will make useCollection in your entity.ts store return a ref containing the mockNodes data. You can
	  adapt this to provide different data for different collections and tests.
- ### Stores
- `app/stores/app.ts`: Test the initial state.
- `app/stores/dialog.ts`: Test opening and closing dialogs, and the callback functionality.
- `app/stores/entity.ts`:
	- Test the `submit` function. This will require more advanced mocking of firebase.
	- Test the computed properties that filter and transform entities.
- `app/stores/simulation.ts`: Test the simulation logic.
- ### Composables
- `app/composables/auth.ts`: Test the `useAuthState` composable with mocked firebase auth.
- `app/composables/feminatyw.ts`: Test the noun declensions.
- `app/composables/party.ts`: Test the party statistics computation.
- ### Components
- Add tests for all components, checking rendering and user interactions.
- `app/components/dialog/MultiDialog.vue`: Test that the correct dialog is shown based on the type.
- `app/components/form/EntityPicker.vue`: Test adding a new item.