import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import {
  redirectPath,
  sendVerificationEmail,
  useAuthState,
} from "@/composables/auth";

// Hoisted variables for mocks
const {
  mockIdTokenFn,
  mockAuth,
  mockUseFetchSpy,
  mockUseDocumentSpy,
  mockSendPasswordResetEmail,
  mockSendEmailVerification,
} = vi.hoisted(() => {
  const fn = vi.fn();
  const tokenFn = vi.fn();
  const docFn = vi.fn();
  return {
    mockUseFetchSpy: fn,
    mockIdTokenFn: tokenFn,
    mockUseDocumentSpy: docFn,
    mockSendPasswordResetEmail: vi.fn(),
    mockSendEmailVerification: vi.fn(),
    mockAuth: {
      languageCode: null as string | null,
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
    sendEmailVerification: mockSendEmailVerification,
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

  it("has Firebase write its mail in Polish", () => {
    mockAuth.languageCode = null;
    useAuthState();
    // Unset, the verification and reset mails - and the page the link opens -
    // come in English.
    expect(mockAuth.languageCode).toBe("pl");
  });
});

describe("redirectPath", () => {
  it("keeps a path on this site, query and all", () => {
    expect(redirectPath("/eksploruj/umowy?powiazanie=ukryte_13")).toBe(
      "/eksploruj/umowy?powiazanie=ukryte_13",
    );
  });

  it("sends anything that could leave the site home", () => {
    for (const redirect of [
      "//evil.example/x",
      "/\\evil.example",
      "https://evil.example",
      "@evil.example",
      "",
      undefined,
      ["/a", "/b"],
    ]) {
      expect(redirectPath(redirect)).toBe("/");
    }
  });
});

describe("sendVerificationEmail", () => {
  const user = { uid: "new-user" } as unknown as Parameters<
    typeof sendVerificationEmail
  >[0];

  beforeEach(() => {
    mockSendEmailVerification.mockReset();
  });

  it("links the mail back to where the reader was going", async () => {
    mockSendEmailVerification.mockResolvedValue(undefined);

    await sendVerificationEmail(user, "/eksploruj/umowy?powiazanie=ukryte_13");

    expect(mockSendEmailVerification).toHaveBeenCalledWith(user, {
      url: `${window.location.origin}/eksploruj/umowy?powiazanie=ukryte_13`,
    });
  });

  it("never links it off the site", async () => {
    mockSendEmailVerification.mockResolvedValue(undefined);

    await sendVerificationEmail(user, "//evil.example");

    expect(mockSendEmailVerification).toHaveBeenCalledWith(user, {
      url: `${window.location.origin}/`,
    });
  });

  it("still sends the mail from a host Firebase will not link back to", async () => {
    mockSendEmailVerification
      .mockRejectedValueOnce({ code: "auth/unauthorized-continue-uri" })
      .mockResolvedValueOnce(undefined);

    await sendVerificationEmail(user, "/eksploruj/umowy");

    expect(mockSendEmailVerification).toHaveBeenCalledTimes(2);
    expect(mockSendEmailVerification).toHaveBeenLastCalledWith(user);
  });

  it("does not retry other failures", async () => {
    mockSendEmailVerification.mockRejectedValue({
      code: "auth/too-many-requests",
    });

    await expect(sendVerificationEmail(user, "/")).rejects.toEqual({
      code: "auth/too-many-requests",
    });
    expect(mockSendEmailVerification).toHaveBeenCalledTimes(1);
  });
});
