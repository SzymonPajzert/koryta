import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";

/** The plugin under test is the one the Nuxt test environment installs when it
 * boots the app, exactly as the browser does - nothing here imports or calls it.
 * These mocks are in place by then, so it watches `currentUser` below and
 * reports through `mockAuthRequest`. */
const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

type FakeUser = { uid: string; getIdTokenResult: () => Promise<unknown> };
const currentUser = ref<FakeUser | null>(null);

vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useCurrentUser: () => currentUser,
}));

vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  authRequest: mockAuthRequest,
}));

/** `IdTokenResult.authTime` is a date string, as the SDK hands it out. */
const MORNING = "Mon, 05 Oct 2026 09:00:00 GMT";
const EVENING = "Mon, 05 Oct 2026 19:00:00 GMT";

const signIn = (authTime = MORNING, uid = "u1") => {
  const user: FakeUser = {
    uid,
    getIdTokenResult: vi.fn(async () => ({ authTime })),
  };
  currentUser.value = user;
  return user;
};

let visibility: DocumentVisibilityState = "visible";
const switchTab = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

/** Long enough for a check to have run to the end, request included. */
const settle = async () => {
  await flushPromises();
  await flushPromises();
};

const reported = () =>
  mockAuthRequest.mock.calls.filter(([url]) => url === "/api/users/seen");

describe("signInStats plugin", () => {
  beforeEach(async () => {
    currentUser.value = null;
    await settle();
    vi.clearAllMocks();
    localStorage.clear();
    mockAuthRequest.mockResolvedValue(null);
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports a signed-in user and remembers the day and the sign-in", async () => {
    signIn();
    await settle();

    expect(reported()).toEqual([["/api/users/seen", { method: "POST" }]]);
    expect(localStorage.getItem("koryta:seen:u1")).toBe(
      `2026-10-05|${MORNING}`,
    );
  });

  it("does nothing while nobody is signed in", async () => {
    switchTab("visible");
    await settle();

    expect(mockAuthRequest).not.toHaveBeenCalled();
  });

  it("does not report the same sign-in twice on one day", async () => {
    localStorage.setItem("koryta:seen:u1", `2026-10-05|${MORNING}`);

    signIn();
    await settle();

    expect(reported()).toHaveLength(0);
  });

  it("reports the same sign-in on a new day", async () => {
    localStorage.setItem("koryta:seen:u1", `2026-10-04|${MORNING}`);

    signIn();
    await settle();

    expect(reported()).toHaveLength(1);
    expect(localStorage.getItem("koryta:seen:u1")).toBe(
      `2026-10-05|${MORNING}`,
    );
  });

  it("reports a new sign-in on the same day", async () => {
    localStorage.setItem("koryta:seen:u1", `2026-10-05|${MORNING}`);

    signIn(EVENING);
    await settle();

    expect(reported()).toHaveLength(1);
  });

  it("keeps each account on the browser apart", async () => {
    localStorage.setItem("koryta:seen:u1", `2026-10-05|${MORNING}`);

    signIn(MORNING, "u2");
    await settle();

    expect(reported()).toHaveLength(1);
    expect(localStorage.getItem("koryta:seen:u2")).toBe(
      `2026-10-05|${MORNING}`,
    );
  });

  it("checks again when a tab left open past midnight comes back", async () => {
    signIn();
    await settle();
    expect(reported()).toHaveLength(1);

    // Back to the tab the same day: nothing new to say.
    switchTab("visible");
    await settle();
    expect(reported()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-06T07:00:00.000Z"));
    // Hiding it is not coming back to it.
    switchTab("hidden");
    await settle();
    expect(reported()).toHaveLength(1);

    switchTab("visible");
    await settle();
    expect(reported()).toHaveLength(2);
    expect(localStorage.getItem("koryta:seen:u1")).toBe(
      `2026-10-06|${MORNING}`,
    );
  });

  it("sends one request when two checks overlap", async () => {
    let answer: (value: null) => void = () => {};
    mockAuthRequest.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)),
    );

    signIn();
    await settle();
    switchTab("visible");
    await settle();
    expect(reported()).toHaveLength(1);

    answer(null);
    await settle();
    switchTab("visible");
    await settle();
    expect(reported()).toHaveLength(1);
  });

  it("swallows a failed request and tries again later", async () => {
    mockAuthRequest.mockRejectedValueOnce(new Error("503"));
    vi.spyOn(console, "debug").mockImplementation(() => {});

    signIn();
    await settle();
    expect(reported()).toHaveLength(1);
    // Not remembered, so it is not a day lost.
    expect(localStorage.getItem("koryta:seen:u1")).toBeNull();

    switchTab("visible");
    await settle();
    expect(reported()).toHaveLength(2);
    expect(localStorage.getItem("koryta:seen:u1")).toBe(
      `2026-10-05|${MORNING}`,
    );
  });

  it("swallows a token it cannot read", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    currentUser.value = {
      uid: "u1",
      getIdTokenResult: vi.fn(async () => {
        throw new Error("auth/network-request-failed");
      }),
    };
    await settle();

    expect(mockAuthRequest).not.toHaveBeenCalled();
  });

  it("reports once per page when the browser refuses storage", async () => {
    // What a browser with site data blocked does: merely reading
    // `localStorage` throws.
    const storage = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    )!;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });

    try {
      // An account of its own: what the plugin keeps in memory for a browser
      // like this lasts as long as the page, which here is the whole file.
      signIn(MORNING, "private");
      await settle();
      switchTab("visible");
      await settle();
    } finally {
      Object.defineProperty(globalThis, "localStorage", storage);
    }

    expect(reported()).toHaveLength(1);
    expect(localStorage.getItem("koryta:seen:private")).toBeNull();
  });
});
