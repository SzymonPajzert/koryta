import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { useAuthState } from "@/composables/auth";
import {
  backOnline,
  goOffline,
  internalError,
  networkRequestFailed,
  restoreOnline,
} from "../../tests/networkFailure";

// Hoisted variables for mocks
const {
  mockIdTokenFn,
  mockAuth,
  mockUseFetchSpy,
  mockUseDocumentSpy,
  mockSendPasswordResetEmail,
} = vi.hoisted(() => {
  const fn = vi.fn();
  const tokenFn = vi.fn();
  const docFn = vi.fn();
  return {
    mockUseFetchSpy: fn,
    mockIdTokenFn: tokenFn,
    mockUseDocumentSpy: docFn,
    mockSendPasswordResetEmail: vi.fn(),
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
    sendPasswordResetEmail: mockSendPasswordResetEmail,
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
  useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  useFirestore: vi.fn(),
  useDocument: mockUseDocumentSpy,
  useIsCurrentUserLoaded: () => ref(true),
  useCurrentUser: () => ref(mockAuth.currentUser),
}));
vi.mock("nuxt-vuefire", () => ({}));

// `useAuthState` reaches these through Nuxt's auto-imports, which re-export
// them from vuefire (see .nuxt/imports.d.ts). Mocking the `vuefire` module
// alone only covers an explicit import, and whether the auto-import chain had
// already been evaluated against the real module varied with which test file
// booted the Nuxt environment first - so `useCurrentUser` threw "called before
// the VueFireAuth module was added" in a full run and passed on its own. Every
// vuefire composable the code under test calls is mocked here as well, so the
// file no longer depends on that order.
mockNuxtImport("useFirebaseAuth", () => {
  return () => mockAuth;
});

mockNuxtImport("useDocument", () => {
  return mockUseDocumentSpy;
});

mockNuxtImport("useCurrentUser", () => {
  return () => ref(mockAuth.currentUser);
});

mockNuxtImport("useFirestore", () => {
  return () => undefined;
});

mockNuxtImport("useFirebaseApp", () => {
  return () => ({ name: "[DEFAULT]" });
});

describe("useAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFetchSpy.mockClear();
    mockIdTokenFn.mockReset();
    mockIdTokenFn.mockResolvedValue("mock-token");
    mockAuth.currentUser.getIdToken = mockIdTokenFn;
  });

  it("returns expected properties", () => {
    const state = useAuthState();
    expect(state.user).toBeDefined();
    expect(state.isAdmin).toBeDefined();
    expect(state.logout).toBeTypeOf("function");
    expect(state.login).toBeTypeOf("function");
    expect(state.register).toBeTypeOf("function");
    expect(state.resetPassword).toBeTypeOf("function");
  });

  it("resetPassword sends the reset email for the given address", async () => {
    const state = useAuthState();
    await state.resetPassword("someone@example.com");
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      mockAuth,
      "someone@example.com",
    );
  });
});

/** The claims come off the token, and reading an expired token refreshes it
 * first. On a device woken with no network that refresh failed, and
 * `computedAsync` handed the error to `reportError`, which Sentry hears as
 * unhandled: KORYTA-PL-KW, K8 and H1. */
describe("useAuthState claims", () => {
  const reportError = vi.fn();
  const readsClaims = (...results: Array<() => Promise<unknown>>) => {
    const read = vi.fn();
    for (const result of results) read.mockImplementationOnce(result);
    mockAuth.currentUser.getIdTokenResult = read;
    return read;
  };

  beforeEach(() => {
    reportError.mockClear();
    // `computedAsync` takes its default `onError` from here when it is made.
    vi.stubGlobal("reportError", reportError);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreOnline();
  });

  it("reads the token once for all three flags", async () => {
    const read = readsClaims(async () => ({
      claims: { admin: true, datascience: true },
    }));
    const state = useAuthState();
    await flushPromises();

    expect(state.isAdmin.value).toBe(true);
    expect(state.isOwner.value).toBe(false);
    expect(state.isDatascience.value).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not report a refresh that failed offline, and reads the claims once back online", async () => {
    goOffline();
    readsClaims(
      () => Promise.reject(networkRequestFailed()),
      async () => ({ claims: { admin: true } }),
    );
    const state = useAuthState();
    await flushPromises();

    expect(state.isAdmin.value).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();

    backOnline();
    await flushPromises();

    expect(state.isAdmin.value).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not report a refresh that failed in a browser that says it is online", async () => {
    const read = readsClaims(
      () => Promise.reject(networkRequestFailed()),
      () => Promise.reject(networkRequestFailed()),
    );
    const state = useAuthState();
    await flushPromises();

    expect(read).toHaveBeenCalledTimes(2);
    expect(state.isAdmin.value).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("still reports any other failure to read the token", async () => {
    const failure = internalError();
    readsClaims(() => Promise.reject(failure));
    useAuthState();
    await flushPromises();

    expect(reportError).toHaveBeenCalledWith(failure);
  });
});

/** `idToken` is a promise read only for whether there is one, and nothing
 * awaits it. Offline its refresh failed with nobody to handle it, and the
 * browser reported the rejection as unhandled. */
describe("useAuthState idToken", () => {
  const unhandled = vi.fn();

  beforeEach(() => {
    unhandled.mockClear();
    process.on("unhandledRejection", unhandled);
    mockAuth.currentUser.getIdTokenResult = vi
      .fn()
      .mockResolvedValue({ claims: {} });
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
  });

  it("leaves no unhandled rejection behind when the refresh fails offline", async () => {
    // A plain function, not a `vi.fn`: a mock handles the promises it
    // returns itself (for `mock.settledResults`), so its rejection would
    // never be unhandled, whatever the code under test did.
    let reads = 0;
    mockAuth.currentUser.getIdToken = (() => {
      reads += 1;
      return Promise.reject(networkRequestFailed());
    }) as unknown as typeof mockIdTokenFn;
    const { idToken } = useAuthState();

    expect(idToken.value).toBeInstanceOf(Promise);
    await flushPromises();

    expect(reads).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
