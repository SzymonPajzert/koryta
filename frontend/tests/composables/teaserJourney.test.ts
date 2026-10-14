import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { trackGoal } from "~/composables/analytics";
import {
  noteSearchPick,
  teaserArrival,
  watchTeaserExit,
} from "~/composables/teaserJourney";

vi.mock("~/composables/analytics", () => ({ trackGoal: vi.fn() }));

const GOAL = { surface: "osoba", kind: "profil" } as const;
const TEASER = "/osoba/jan-kowalski-p1";

/** A router that answers any path, at `start`, with `before` behind it in the
 * history so there is somewhere to go back to. */
async function routerAt(start: string, before = "/eksploruj/tabela") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:rest(.*)*", component: { render: () => null } }],
  });
  await router.push(before);
  await router.push(start);
  await router.isReady();
  return router;
}

/** Waits for whatever navigation is in flight to finish. */
const settled = (router: Router) =>
  new Promise<void>((resolve) => {
    const stop = router.afterEach(() => {
      stop();
      resolve();
    });
  });

describe("teaserArrival", () => {
  beforeEach(() => {
    // Take any pick left by an earlier test.
    teaserArrival("", null);
  });

  it("says the search box sent the reader to the person it just opened", () => {
    noteSearchPick("p1");
    expect(teaserArrival("p1", { back: "/" })).toBe("search");
  });

  it("takes the pick, so coming back to them later is not a search", () => {
    noteSearchPick("p1");
    teaserArrival("p1", { back: "/" });
    expect(teaserArrival("p1", { back: "/" })).toBe("link");
  });

  it("does not credit the search box with somebody it did not open", () => {
    noteSearchPick("p2");
    expect(teaserArrival("p1", { back: "/" })).toBe("link");
  });

  it("calls the first page of a visit an entry", () => {
    // A shared link, a bookmark or a search engine: nothing behind it.
    expect(teaserArrival("p1", { back: null })).toBe("entry");
    expect(teaserArrival("p1", null)).toBe("entry");
  });
});

describe("watchTeaserExit", () => {
  beforeEach(() => {
    vi.mocked(trackGoal).mockClear();
    teaserArrival("", null);
  });

  it("reports a reader who went on to another page through a link", async () => {
    const router = await routerAt(TEASER);
    watchTeaserExit(router, TEASER, GOAL);

    await router.push("/instytucja/energa-c1");

    expect(trackGoal).toHaveBeenCalledWith("teaser:continued", {
      ...GOAL,
      via: "link",
      to: "instytucja",
    });
  });

  it("tells the back button apart", async () => {
    const router = await routerAt(TEASER, "/eksploruj/tabela");
    watchTeaserExit(router, TEASER, GOAL);

    const done = settled(router);
    router.back();
    await done;

    expect(trackGoal).toHaveBeenCalledWith("teaser:continued", {
      ...GOAL,
      via: "back",
      to: "tabela",
    });
  });

  it("tells a second search apart", async () => {
    const router = await routerAt(TEASER);
    watchTeaserExit(router, TEASER, GOAL);

    noteSearchPick("p2");
    await router.push("/osoba/anna-nowak-p2");

    expect(trackGoal).toHaveBeenCalledWith("teaser:continued", {
      ...GOAL,
      via: "search",
      to: "osoba",
    });
  });

  it("leaves the sign-in button to teaser:click, and stops watching", async () => {
    const router = await routerAt(TEASER);
    watchTeaserExit(router, TEASER, GOAL);

    await router.push(`/login?redirect=${encodeURIComponent(TEASER)}`);
    await router.push("/");

    expect(trackGoal).not.toHaveBeenCalled();
  });

  it("ignores a change that stays on the teaser, and reports only once", async () => {
    const router = await routerAt(TEASER);
    watchTeaserExit(router, TEASER, GOAL);

    await router.push(`${TEASER}?tab=1`);
    expect(trackGoal).not.toHaveBeenCalled();

    await router.push("/");
    await router.push("/pomoc");
    expect(trackGoal).toHaveBeenCalledTimes(1);
    expect(trackGoal).toHaveBeenCalledWith("teaser:continued", {
      ...GOAL,
      via: "link",
      to: "home",
    });
  });
});
