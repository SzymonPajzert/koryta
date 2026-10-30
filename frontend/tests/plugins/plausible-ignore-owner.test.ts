import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, ref, type EffectScope, type Ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { User } from "firebase/auth";
import { useCurrentUser } from "vuefire";
import ignoreOwner from "../../app/plugins/plausible-ignore-owner.client";
// The tracker itself, by path: vitest.config.ts points the package name at a
// stub for every other test. The flag is the tracker's contract rather than
// ours, so the test that it holds has to run against the copy the site ships.
import {
  init,
  track,
} from "../../node_modules/@plausible-analytics/tracker/plausible.js";

/** The key the tracker reads, spelled out rather than shared with the plugin,
 * so a rename on either side fails here. */
const FLAG = "plausible_ignore";

type CurrentUser = User | null | undefined;

/** A signed-in user whose token carries `claims`. */
const signedIn = (claims: Record<string, unknown>) =>
  ({ getIdTokenResult: async () => ({ claims }) }) as unknown as User;

let scope: EffectScope;

/** Runs the plugin against `user`, as Nuxt does at boot. */
const install = (user: Ref<CurrentUser>) => {
  vi.mocked(useCurrentUser).mockReturnValueOnce(user as never);
  scope.run(() => (ignoreOwner as unknown as () => void)());
};

/** Rejections left unhandled while `run` ran. Vitest reports those against
 * the file rather than the test, so a plugin that leaked one would pass here
 * and still turn the run red. */
const unhandledDuring = async (run: () => Promise<void>) => {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", listener);
  try {
    await run();
  } finally {
    process.off("unhandledRejection", listener);
  }
  return reasons;
};

describe("plausible-ignore-owner plugin", () => {
  beforeEach(() => {
    localStorage.removeItem(FLAG);
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  it("keeps the owner's browser out once his token shows the claim", async () => {
    install(ref(signedIn({ admin: true, owner: true })));
    await flushPromises();

    expect(localStorage.getItem(FLAG)).toBe("true");
  });

  it("catches the owner signing in after the page has loaded", async () => {
    const user = ref<CurrentUser>(undefined);
    install(user);
    await flushPromises();
    expect(localStorage.getItem(FLAG)).toBeNull();

    user.value = signedIn({ owner: true });
    await flushPromises();
    expect(localStorage.getItem(FLAG)).toBe("true");
  });

  it("counts everybody else, administrators included", async () => {
    install(ref(signedIn({ admin: true })));
    install(ref(null));
    await flushPromises();

    expect(localStorage.getItem(FLAG)).toBeNull();
  });

  it("leaves the flag set when the owner signs out", async () => {
    const user = ref<CurrentUser>(signedIn({ owner: true }));
    install(user);
    await flushPromises();

    user.value = null;
    await flushPromises();
    expect(localStorage.getItem(FLAG)).toBe("true");
  });

  it("counts the visit, and raises nothing, when the token cannot be read", async () => {
    const offline = {
      getIdTokenResult: () =>
        Promise.reject(new Error("auth/network-request-failed")),
    } as unknown as User;

    const unhandled = await unhandledDuring(async () => {
      install(ref(offline));
      await flushPromises();
    });

    expect(unhandled).toEqual([]);
    expect(localStorage.getItem(FLAG)).toBeNull();
  });

  /** A browser with this site's data blocked throws on any read of
   * `localStorage`, not only on a write. */
  it("counts the visit, and raises nothing, when the browser refuses storage", async () => {
    const unhandled = await unhandledDuring(async () => {
      const storage = Object.getOwnPropertyDescriptor(
        globalThis,
        "localStorage",
      )!;
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException(
            "Access is denied for this document.",
            "SecurityError",
          );
        },
      });
      try {
        install(ref(signedIn({ owner: true })));
        await flushPromises();
      } finally {
        Object.defineProperty(globalThis, "localStorage", storage);
      }
    });

    expect(unhandled).toEqual([]);
    expect(localStorage.getItem(FLAG)).toBeNull();
  });
});

describe("the Plausible tracker the site ships", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(FLAG);
  });

  it("sends nothing while the flag is set, and sends again once it is gone", () => {
    const send = vi.fn(() => Promise.resolve({ status: 202 }));
    vi.stubGlobal("fetch", send);
    init({
      // Nowhere real, in case the stub above ever stops catching the request.
      domain: "test.invalid",
      endpoint: "https://plausible.invalid/api/event",
      // This test sends its own event, from localhost, where the tracker would
      // otherwise drop everything before it got as far as the flag.
      autoCapturePageviews: false,
      captureOnLocalhost: true,
      bindToWindow: false,
      logging: false,
    });

    localStorage.setItem(FLAG, "true");
    const ignored = vi.fn();
    track("test", { callback: ignored });
    expect(send).not.toHaveBeenCalled();
    // The tracker's own signal for an ignored event: a callback with no result.
    expect(ignored).toHaveBeenCalledWith();

    localStorage.removeItem(FLAG);
    track("test", {});
    expect(send).toHaveBeenCalledTimes(1);
  });
});
