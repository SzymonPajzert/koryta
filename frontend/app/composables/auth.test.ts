import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useAuthState } from "./auth";

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
}));
vi.mock("nuxt-vuefire", () => ({}));

// Mock Nuxt imports
mockNuxtImport("useFetch", () => {
  return mockUseFetchSpy;
});

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
    const { authFetch } = useAuthState();
    const mockOptions = { headers: {} };

    // Simulate authFetch call
    authFetch("/api/test", mockOptions);

    // Verify useFetch was called
    expect(mockUseFetchSpy).toHaveBeenCalled();
    const callArgs = mockUseFetchSpy.mock.calls[0];

    if (!callArgs) {
      throw new Error("useFetch was not called");
    }

    expect(callArgs[0]).toBe("/api/test");
    const fetchOptions = callArgs[1];

    // Execute the interceptor
    await fetchOptions.onRequest({ options: mockOptions });

    // Verify logic
    expect(mockIdTokenFn).toHaveBeenCalled();
  });

  it("authFetch should add Authorization header", async () => {
    mockIdTokenFn.mockResolvedValue("new-token");
    const { authFetch } = useAuthState();
    const mockOptions = { headers: {} as any };

    authFetch("/api/test", mockOptions);

    expect(mockUseFetchSpy).toHaveBeenCalled();
    const callArgs = mockUseFetchSpy.mock.calls[0];

    if (!callArgs) {
      throw new Error("useFetch was not called");
    }

    const fetchOptions = callArgs[1];

    await fetchOptions.onRequest({ options: mockOptions });

    expect((mockOptions.headers as Headers).get("Authorization")).toBe(
      "Bearer new-token",
    );
  });
});
