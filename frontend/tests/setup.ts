import { vi } from 'vitest';
import { ref } from 'vue';

vi.mock('vuefire', () => ({
  useFirestore: vi.fn(() => ({})),
  useCollection: vi.fn(() => ref([])), // Return a ref with an empty array
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
  };
});

vi.mock('nuxt-vuefire', () => ({
  useCurrentUser: vi.fn(),
}));