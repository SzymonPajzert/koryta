import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useCurrentUser } from "vuefire";
import { useHydrated, useRenderedUser } from "../../app/composables/hydrated";

/** A stand-in for the app, with the one hook `useHydrated` waits for. Each
 * test gets its own, as each page load does. */
const { app } = vi.hoisted(() => ({
  app: {
    current: null as null | {
      isHydrating: boolean;
      resolve: () => void;
      hooks: { hookOnce: (name: string, fn: () => void) => void };
    },
  },
}));

function newApp(isHydrating: boolean) {
  const listeners: (() => void)[] = [];
  app.current = {
    isHydrating,
    resolve: () => listeners.splice(0).forEach((fn) => fn()),
    hooks: {
      hookOnce: (name, fn) => {
        if (name === "app:suspense:resolve") listeners.push(fn);
      },
    },
  };
  return app.current;
}

// The real app everywhere else - the test environment boots on it - and the
// stand-in for the composable under test once a test has made one.
mockNuxtImport(
  "useNuxtApp",
  (original: () => unknown) => () => app.current ?? original(),
);

const READER = { uid: "u1", email: "czytelnik@example.com" };

describe("useHydrated", () => {
  it("is false while the server's html is being hydrated, and true after", () => {
    const nuxtApp = newApp(true);
    const hydrated = useHydrated();

    expect(hydrated.value).toBe(false);
    nuxtApp.resolve();
    expect(hydrated.value).toBe(true);
  });

  it("is true at once on a client-side navigation, with nothing to hydrate", () => {
    newApp(false);

    expect(useHydrated().value).toBe(true);
  });

  it("is one flag for every caller on the page", () => {
    const nuxtApp = newApp(true);
    const first = useHydrated();
    const second = useHydrated();

    nuxtApp.resolve();
    expect([first.value, second.value]).toEqual([true, true]);
  });
});

describe("useRenderedUser", () => {
  it("hides a session firebase restored before hydration finished", () => {
    // The race that sent signed-in readers of /eksploruj/umowy to the 500
    // page: the session is there, the html under the render is for nobody.
    vi.mocked(useCurrentUser).mockReturnValue(ref(READER) as never);
    const nuxtApp = newApp(true);
    const user = useRenderedUser();

    expect(user.value).toBeUndefined();
    nuxtApp.resolve();
    expect(user.value).toEqual(READER);
  });

  it("passes a signed-out reader through as firebase has them", () => {
    vi.mocked(useCurrentUser).mockReturnValue(ref(null) as never);
    newApp(false);

    expect(useRenderedUser().value).toBeNull();
  });
});
