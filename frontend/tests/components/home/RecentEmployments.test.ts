import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import RecentEmployments from "../../../app/components/home/RecentEmployments.vue";
import type {
  RecentEmployment,
  RecentEmployments as Response,
} from "../../../server/api/edges/recentEmployments.get";

/** The pages the endpoint will hand out, keyed by the cursor that asks for
 * them. `null` is the first page, which carries no cursor. */
let pages: Record<string, Response> = {};

/** Every cursor the component asked for, in order, so a test can say it never
 * asked twice for the same page. */
const asked: (string | null)[] = [];

registerEndpoint("/api/edges/recentEmployments", (event) => {
  const cursor =
    new URL(event.node.req.url ?? "/", "http://test").searchParams.get(
      "cursor",
    ) ?? null;
  asked.push(cursor);
  return pages[cursor ?? "first"] ?? { employments: [], nextCursor: null };
});

function employment(id: string, start = "2024-01-01"): RecentEmployment {
  return {
    id,
    personId: `p-${id}`,
    personName: `Osoba ${id}`,
    parties: [],
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    start_date: start,
    end_date: null,
  };
}

/** Mounts and waits for the first page.
 *
 * The component does not await its own fetch - Nuxt settles `useAsyncData`
 * before it serialises a server rendered page, and awaiting would hold the
 * whole route on this one section during a client side navigation. That is
 * exactly the state `mountSuspended` returns in, so the spinner is what is on
 * screen until the request lands.
 */
async function mountFeed() {
  const wrapper = await mountSuspended(RecentEmployments);
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="recent-employments"]').exists() ||
      wrapper.find('[data-testid="recent-employments-empty"]').exists(),
    { timeout: 2000 },
  );
  return wrapper;
}

/** Drives the load the intersection observer would have driven. jsdom has no
 * IntersectionObserver, so Vuetify's sentinel never fires on its own - the
 * handler under test is reached by emitting what it would have emitted. */
async function scrollToEnd(
  wrapper: Awaited<ReturnType<typeof mountSuspended>>,
): Promise<"ok" | "empty" | "error"> {
  const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });
  let status: "ok" | "empty" | "error" | null = null;
  const done = (s: "ok" | "empty" | "error") => {
    status = s;
  };
  scroll.vm.$emit("load", { side: "end", done });
  await vi.waitUntil(() => status !== null, { timeout: 2000 });
  await wrapper.vm.$nextTick();
  return status!;
}

describe("HomeRecentEmployments", () => {
  beforeEach(() => {
    asked.length = 0;
    pages = {};
    // One Nuxt app serves the whole file, so the first page the previous test
    // fetched is still in the payload and the next mount would re-serve it
    // without asking for anything.
    clearNuxtData();
  });

  it("draws a card for every employment on the first page", async () => {
    pages.first = {
      employments: [employment("a"), employment("b")],
      nextCursor: null,
    };

    const wrapper = await mountFeed();

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(wrapper.find('[data-testid="recent-employments"]').exists()).toBe(
      true,
    );
  });

  it("appends the next page rather than replacing what is on screen", async () => {
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [employment("b")], nextCursor: null };

    const wrapper = await mountFeed();
    expect(wrapper.text()).not.toContain("Osoba b");

    await scrollToEnd(wrapper);

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(asked).toEqual([null, "c1"]);
  });

  it("stops asking once the feed says there is nothing behind it", async () => {
    pages.first = { employments: [employment("a")], nextCursor: null };

    const wrapper = await mountFeed();
    const status = await scrollToEnd(wrapper);

    // `empty` is what makes Vuetify stop firing the sentinel, so this is the
    // difference between a settled feed and one that requests forever.
    expect(status).toBe("empty");
    expect(asked).toEqual([null]);
  });

  it("keeps going when a page comes back empty but still carries a cursor", async () => {
    // The endpoint stops scanning before it has filled a page, so an empty
    // page is not the end of the feed - the cursor says whether it is.
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [], nextCursor: "c2" };
    pages.c2 = { employments: [employment("b")], nextCursor: "c3" };

    const wrapper = await mountFeed();

    // One load, two requests: handing an empty page straight back would leave
    // a button that visibly did nothing.
    expect(await scrollToEnd(wrapper)).toBe("ok");
    expect(asked).toEqual([null, "c1", "c2"]);
    expect(wrapper.text()).toContain("Osoba b");
  });

  it("gives up on a run of empty pages rather than asking forever", async () => {
    // Unbounded, this is what the feed used to do on its own, once every few
    // animation frames, at several hundred document reads a time.
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [], nextCursor: "c2" };
    pages.c2 = { employments: [], nextCursor: "c3" };
    pages.c3 = { employments: [], nextCursor: "c4" };
    pages.c4 = { employments: [], nextCursor: "c5" };

    const wrapper = await mountFeed();

    expect(await scrollToEnd(wrapper)).toBe("ok");
    expect(asked).toEqual([null, "c1", "c2", "c3"]);
  });

  it("stops loading by itself after two pages, and offers a button instead", async () => {
    // Otherwise the page has no bottom: every scroll towards the footer adds
    // another screen of cards above it, so the footer is never reached.
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [employment("b")], nextCursor: "c2" };
    pages.c2 = { employments: [employment("c")], nextCursor: "c3" };
    pages.c3 = { employments: [employment("d")], nextCursor: "c4" };

    const wrapper = await mountFeed();
    const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });
    expect(scroll.props("mode")).toBe("intersect");

    await scrollToEnd(wrapper);
    expect(scroll.props("mode")).toBe("intersect");

    await scrollToEnd(wrapper);
    expect(scroll.props("mode")).toBe("manual");

    // Still loads on request - it is a button now, not a stop.
    expect(await scrollToEnd(wrapper)).toBe("ok");
    expect(wrapper.text()).toContain("Osoba d");
  });

  it("says so when there is nothing to show at all", async () => {
    pages.first = { employments: [], nextCursor: null };

    const wrapper = await mountFeed();

    expect(
      wrapper.find('[data-testid="recent-employments-empty"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="recent-employments"]').exists()).toBe(
      false,
    );
  });

  it("labels the end of the feed in Polish, not Vuetify's English", async () => {
    pages.first = { employments: [employment("a")], nextCursor: null };

    const wrapper = await mountFeed();
    const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });

    expect(scroll.props("emptyText")).toBe(
      "To już wszystkie zatrudnienia, jakie znamy.",
    );
  });
});
