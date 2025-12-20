import { vi } from 'vitest';
import { ref } from 'vue';

vi.mock('vuefire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vuefire')>();
  return {
    ...actual,
    useFirestore: vi.fn(() => ({})),
    useCollection: vi.fn(() => ref([])), // Return a ref with an empty array
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
  };
});

vi.mock('firebase/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('firebase/auth')>();
    return {
        ...actual,
        getAuth: vi.fn(() => ({})),
        initializeAuth: vi.fn(() => ({})),
        connectAuthEmulator: vi.fn(),
        onAuthStateChanged: vi.fn(),
        signInWithEmailAndPassword: vi.fn(),
        createUserWithEmailAndPassword: vi.fn(),
        signOut: vi.fn(),
    }
});

vi.mock('nuxt-vuefire', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('@sentry/nuxt', () => ({
  init: vi.fn(),
  replayIntegration: vi.fn(),
}));