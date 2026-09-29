import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import EventFeed from "../../../app/components/home/EventFeed.vue";
import type {
  RecentEmployment,
  RecentEmployments as Response,
} from "../../../server/api/edges/recentEmployments.get";
import type {
  ServiceMilestone,
  ServiceMilestones,
} from "../../../server/api/edges/serviceMilestones.get";

/** The pages the endpoint will hand out, keyed by the cursor that asks for
 * them. `null` is the first page, which carries no cursor. */
let pages: Record<string, Response> = {};

/** Every cursor the component asked for, in order, so a test can say it never
 * asked twice for the same page. */
const asked: (string | null)[] = [];

/** What the milestone endpoint will answer with. Empty by default, so every
 * test that is about the employment paging stays about that. */
let milestones: ServiceMilestone[] = [];

/** Set by the one test about the endpoint being down. */
let milestonesFail = false;

registerEndpoint("/api/edges/serviceMilestones", (): ServiceMilestones => {
  if (milestonesFail) throw new Error("milestones are down");
  return {
    milestones,
    scope: "recent",
    total: milestones.length,
    upcoming: 0,
    past: milestones.length,
    nextOffset: null,
    today: "2026-09-10",
  };
});

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

function milestone(
  id: string,
  date: string,
  fields: Partial<ServiceMilestone> = {},
): ServiceMilestone {
  return {
    id,
    personId: `m-${id}`,
    personName: `Jubilat ${id}`,
    parties: [],
    years: 10,
    date,
    daysFromToday: -1,
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    alsoHeld: 0,
    institutions: 1,
    spells: 1,
    projected: false,
    ...fields,
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
  const wrapper = await mountSuspended(EventFeed);
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="home-event-feed"]').exists() ||
      wrapper.find('[data-testid="home-event-feed-empty"]').exists(),
    { timeout: 2000 },
  );
  return wrapper;
}

/** The feed as the reader sees it: every card in the grid, in order, named by
 * its testid. Both card kinds are in one list on purpose - the order across
 * them is the thing under test. */
function cardIds(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  return wrapper
    .findAll(".employment-card, .milestone-card")
    .map((card) => card.attributes("data-testid"));
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

describe("HomeEventFeed", () => {
  beforeEach(() => {
    asked.length = 0;
    pages = {};
    milestones = [];
    milestonesFail = false;
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
    expect(wrapper.find('[data-testid="home-event-feed"]').exists()).toBe(true);
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

  it("never loads a page by itself - it is a button from the first one", async () => {
    // Otherwise the page has no bottom: every scroll towards the footer adds
    // another screen of cards above it, so the footer is never reached.
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [employment("b")], nextCursor: "c2" };
    pages.c2 = { employments: [employment("c")], nextCursor: "c3" };

    const wrapper = await mountFeed();
    const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });
    expect(scroll.props("mode")).toBe("manual");

    // A button, not a stop: it still loads, and it stays a button after.
    expect(await scrollToEnd(wrapper)).toBe("ok");
    expect(wrapper.text()).toContain("Osoba b");
    expect(scroll.props("mode")).toBe("manual");

    expect(await scrollToEnd(wrapper)).toBe("ok");
    expect(wrapper.text()).toContain("Osoba c");
    expect(scroll.props("mode")).toBe("manual");
  });

  it("says so when there is nothing to show at all", async () => {
    pages.first = { employments: [], nextCursor: null };

    const wrapper = await mountFeed();

    expect(wrapper.find('[data-testid="home-event-feed-empty"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="home-event-feed"]').exists()).toBe(
      false,
    );
  });

  it("labels the end of the feed in Polish, not Vuetify's English", async () => {
    pages.first = { employments: [employment("a")], nextCursor: null };

    const wrapper = await mountFeed();
    const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });

    expect(scroll.props("emptyText")).toBe("To już wszystko, co wiemy.");
  });

  it("slots an anniversary between the employments it falls between", async () => {
    pages.first = {
      employments: [
        employment("a", "2026-09-08"),
        employment("b", "2026-09-02"),
      ],
      nextCursor: null,
    };
    milestones = [milestone("m", "2026-09-05")];

    const wrapper = await mountFeed();

    expect(cardIds(wrapper)).toEqual([
      "recent-employment-a",
      "service-milestone-m",
      "recent-employment-b",
    ]);
  });

  it("puts an anniversary above the employments of its own day", async () => {
    pages.first = {
      employments: [employment("a", "2026-09-05")],
      nextCursor: null,
    };
    milestones = [milestone("m", "2026-09-05")];

    const wrapper = await mountFeed();

    expect(cardIds(wrapper)).toEqual([
      "service-milestone-m",
      "recent-employment-a",
    ]);
  });

  it("holds an anniversary back until the employments have reached its date", async () => {
    // Drawn at the bottom of the first page it would be correct for one
    // moment, and would then jump *up* the page as the next page arrived
    // underneath it - while somebody was reading it.
    pages.first = {
      employments: [employment("a", "2026-09-08")],
      nextCursor: "c1",
    };
    pages.c1 = {
      employments: [employment("b", "2026-09-02")],
      nextCursor: null,
    };
    milestones = [milestone("m", "2026-09-05")];

    const wrapper = await mountFeed();
    expect(cardIds(wrapper)).toEqual(["recent-employment-a"]);

    await scrollToEnd(wrapper);

    expect(cardIds(wrapper)).toEqual([
      "recent-employment-a",
      "service-milestone-m",
      "recent-employment-b",
    ]);
  });

  it("draws the anniversaries the employments never reach once the feed ends", async () => {
    pages.first = {
      employments: [employment("a", "2026-09-08")],
      nextCursor: null,
    };
    milestones = [milestone("m", "2026-08-20")];

    const wrapper = await mountFeed();

    expect(cardIds(wrapper)).toEqual([
      "recent-employment-a",
      "service-milestone-m",
    ]);
  });

  it("gives the anniversary card its flare", async () => {
    // The whole reason it is on this page rather than only on /eksploruj/staz:
    // beside a column of appointments it has to read as the one piece of good
    // news on it.
    pages.first = { employments: [], nextCursor: null };
    milestones = [milestone("m", "2026-09-05")];

    const wrapper = await mountFeed();

    expect(wrapper.find(".milestone-card--festive").exists()).toBe(true);
  });

  describe("how much of it is on the page", () => {
    /** A first page as long as the endpoint's: twenty employments, a day
     * apart and newest first, with a cursor behind them. */
    const twenty = (cursor: string | null = "c1") => ({
      employments: Array.from({ length: 20 }, (_, i) =>
        employment(`e${String(i).padStart(2, "0")}`, day(20 - i)),
      ),
      nextCursor: cursor,
    });
    const day = (n: number) => `2026-08-${String(n).padStart(2, "0")}`;

    /** The cards a narrow screen keeps out of sight until „Pokaż więcej”. */
    const folded = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) =>
      wrapper
        .findAll(".event-feed__card--folded")
        .map((card) => card.attributes("data-testid"));

    /** One column, as a phone answers the component's media query. */
    const onAPhone = () =>
      vi
        .spyOn(window, "matchMedia")
        .mockImplementation(
          (query) => ({ matches: true, media: query }) as MediaQueryList,
        );

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("opens on eight rows of a desktop's two columns, not the whole first request", async () => {
      // Twenty employments and every anniversary between them used to be
      // drawn: 37 cards on 2026-09-29, twelve screens of a phone before the
      // footer.
      pages.first = twenty();

      const wrapper = await mountFeed();

      expect(cardIds(wrapper)).toHaveLength(16);
      expect(cardIds(wrapper).at(-1)).toBe("recent-employment-e15");
      expect(asked).toEqual([null]);
    });

    it("cuts the merged feed, so the anniversaries count towards the eight rows", async () => {
      pages.first = twenty();
      // Between the first and the second employment, and after the sixteenth.
      milestones = [
        milestone("early", "2026-08-19"),
        milestone("late", "2026-08-04"),
      ];

      const wrapper = await mountFeed();

      const ids = cardIds(wrapper);
      expect(ids).toHaveLength(16);
      expect(ids.slice(0, 3)).toEqual([
        "recent-employment-e00",
        "service-milestone-early",
        "recent-employment-e01",
      ]);
      expect(ids.at(-1)).toBe("recent-employment-e14");
      expect(ids).not.toContain("service-milestone-late");
    });

    it("sends every screen the same sixteen, and folds the second half away for one column", async () => {
      // The server has no viewport to ask, so a count that depended on one
      // would make the page jump as it hydrated. The fold is css, under
      // Vuetify's md - the width the grid goes down to one column at.
      pages.first = twenty();

      const wrapper = await mountFeed();

      expect(folded(wrapper)).toEqual(cardIds(wrapper).slice(8));
    });

    it("shows a phone the folded half before it asks for anything", async () => {
      onAPhone();
      pages.first = twenty();
      pages.c1 = {
        employments: [employment("next", "2026-07-01")],
        nextCursor: null,
      };

      const wrapper = await mountFeed();

      expect(await scrollToEnd(wrapper)).toBe("ok");
      expect(folded(wrapper)).toEqual([]);
      expect(cardIds(wrapper)).toHaveLength(16);
      expect(asked).toEqual([null]);

      // Then eight rows of its one column a click: the four employments still
      // in hand, and the page behind them.
      expect(await scrollToEnd(wrapper)).toBe("empty");
      expect(cardIds(wrapper)).toHaveLength(21);
      expect(cardIds(wrapper).at(-1)).toBe("recent-employment-next");
      expect(asked).toEqual([null, "c1"]);
    });

    it("brings a desktop eight more rows a click, from the cards in hand first", async () => {
      pages.first = twenty();
      pages.c1 = {
        employments: [employment("next", "2026-07-01")],
        nextCursor: "c2",
      };
      milestones = Array.from({ length: 17 }, (_, i) =>
        milestone(`m${i}`, day(20 - i)),
      );

      const wrapper = await mountFeed();
      expect(cardIds(wrapper)).toHaveLength(16);

      // 37 cards in hand - the first request and its anniversaries - so the
      // next sixteen need no request.
      expect(await scrollToEnd(wrapper)).toBe("ok");
      expect(cardIds(wrapper)).toHaveLength(32);
      expect(asked).toEqual([null]);

      expect(await scrollToEnd(wrapper)).toBe("ok");
      expect(cardIds(wrapper)).toHaveLength(38);
      expect(asked).toEqual([null, "c1"]);
    });

    it("keeps what the last page brought past the cut for the next click", async () => {
      // The endpoint has run out, but not the cards: saying "empty" here
      // would have left eight employments fetched and never drawn.
      pages.first = twenty();
      pages.c1 = { ...twenty(null) };
      pages.c1.employments = pages.c1.employments.map((row) =>
        employment(`${row.id}b`, row.start_date.replace("2026-08", "2026-07")),
      );

      const wrapper = await mountFeed();

      expect(await scrollToEnd(wrapper)).toBe("ok");
      expect(cardIds(wrapper)).toHaveLength(32);

      expect(await scrollToEnd(wrapper)).toBe("empty");
      expect(cardIds(wrapper)).toHaveLength(40);
      expect(asked).toEqual([null, "c1"]);
    });
  });

  it("is still a feed of jobs when the anniversaries cannot be fetched", async () => {
    // The employments are the spine; the anniversaries are garnish and must
    // not be able to take the section down with them.
    milestonesFail = true;
    pages.first = { employments: [employment("a")], nextCursor: null };

    const wrapper = await mountFeed();

    expect(cardIds(wrapper)).toEqual(["recent-employment-a"]);
  });
});
