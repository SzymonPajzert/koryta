import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import { authFetch } from "@/composables/auth";

// Hoisted variables for mocks
const { mockIdTokenFn, mockAuth, mockUseFetchSpy, mockUseDocumentSpy } =
  vi.hoisted(() => {
    const fn = vi.fn();
    const tokenFn = vi.fn();
    const docFn = vi.fn();
    return {
      mockUseFetchSpy: fn,
      mockIdTokenFn: tokenFn,
      mockUseDocumentSpy: docFn,
      mockAuth: {
        currentUser: {
          uid: "test-uid",
          getIdToken: tokenFn,
          getIdTokenResult: vi
            .fn()
            .mockResolvedValue({ claims: { admin: false }, token: "token" }),
        },
      },
    };
  });

// Mock firebase/auth used by the composable
vi.mock("firebase/auth", async () => {
  return {
    getAuth: vi.fn(() => mockAuth),
    onIdTokenChanged: vi.fn(),
    signOut: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    GoogleAuthProvider: vi.fn(),
    Auth: {},
  };
});

// Mock firebase/firestore
vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
}));

// Mock vuefire to prevent initialization errors and provide useDocument
vi.mock("vuefire", () => ({
  useFirebaseAuth: () => mockAuth,
  useFirestore: vi.fn(),
  useDocument: mockUseDocumentSpy,
  useIsCurrentUserLoaded: () => ref(true),
  useCurrentUser: () => ref(mockAuth.currentUser),
}));
vi.mock("nuxt-vuefire", () => ({}));

mockNuxtImport("useFirebaseAuth", () => {
  return () => mockAuth;
});

mockNuxtImport("useDocument", () => {
  return mockUseDocumentSpy;
});

describe("useAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFetchSpy.mockClear();
    mockIdTokenFn.mockReset();
    mockIdTokenFn.mockResolvedValue("mock-token");
    mockAuth.currentUser.getIdToken = mockIdTokenFn;
  });

  it("authFetch should call getIdToken before request", async () => {
    const mockOptions = { headers: {} };

    // Execute the interceptor
    await authFetch("/api/edges", mockOptions);

    // Verify logic
    expect(mockIdTokenFn).toHaveBeenCalled();
  });
});
