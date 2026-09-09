import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import RocznicePage from "../../../app/pages/eksploruj/rocznice.vue";
import type {
  WorkAnniversary,
  WorkAnniversaries as Response,
} from "../../../server/api/edges/anniversaries.get";

/** The pages the endpoint will hand out, keyed by the offset that asks for
 * them. The first page asks for none. */
let pages: Record<string, Response> = {};

/** Every offset the page asked for, in order, so a test can say it never asked
 * twice for the same slice. */
const asked: (string | null)[] = [];

registerEndpoint("/api/edges/anniversaries", (event) => {
  const offset =
    new URL(event.node.req.url ?? "/", "http://test").searchParams.get(
      "offset",
    ) ?? null;
  asked.push(offset);
  return (
    pages[offset ?? "first"] ?? {
      anniversaries: [],
      total: 0,
      upcoming: 0,
      nextOffset: null,
      today: "2026-09-09",
    }
  );
});

function anniversary(
  id: string,
  fields: Partial<WorkAnniversary> = {},
): WorkAnniversary {
  return {
    id,
    personId: `p-${id}`,
    personName: `Osoba ${id}`,
    parties: [],
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    start_date: "2016-09-09",
    ongoing: true,
    date: "2026-09-09",
    years: 10,
    daysFromToday: 0,
    experienceYears: 12,
    ...fields,
  };
}

function response(fields: Partial<Response> = {}): Response {
  return {
    anniversaries: [],
    total: 0,
    upcoming: 0,
    nextOffset: null,
    today: "2026-09-09",
    ...fields,
  };
}

/** Mounts and waits for the first page.
 *
 * The page does not await its own fetch - awaiting would hold the whole route
 * on it during a client side navigation - which is exactly the state
 * `mountSuspended` returns in, so the spinner is what is on screen until the
 * request lands.
 */
async function mountPage() {
  const wrapper = await mountSuspended(RocznicePage);
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="work-anniversaries"]').exists() ||
      wrapper.find('[data-testid="work-anniversaries-empty"]').exists(),
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

describe("eksploruj/rocznice", () => {
  beforeEach(() => {
    asked.length = 0;
    pages = {};
    // One Nuxt app serves the whole file, so the first page the previous test
    // fetched is still in the payload and the next mount would re-serve it
    // without asking for anything.
    clearNuxtData();
  });

  it("draws a card for every anniversary on the first page", async () => {
    pages.first = response({
      anniversaries: [anniversary("a"), anniversary("b")],
      total: 2,
      upcoming: 2,
    });

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(wrapper.find('[data-testid="work-anniversaries"]').exists()).toBe(
      true,
    );
  });

  it("counts the whole window rather than what has loaded", async () => {
    // „w tym N jeszcze przed nami” read off the cards on screen would say 0
    // until somebody had scrolled past today, which is most of the window.
    pages.first = response({
      anniversaries: [anniversary("a", { daysFromToday: -12 })],
      total: 411,
      upcoming: 190,
      nextOffset: 1,
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="anniversaries-summary"]').text()).toBe(
      "411 rocznic, w tym 190 jeszcze przed nami",
    );
  });

  it("says only the total when the whole window is behind us", async () => {
    pages.first = response({
      anniversaries: [anniversary("a", { daysFromToday: -12 })],
      total: 3,
      upcoming: 0,
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="anniversaries-summary"]').text()).toBe(
      "3 rocznice",
    );
  });

  it("appends the next page rather than replacing what is on screen", async () => {
    pages.first = response({
      anniversaries: [anniversary("a")],
      total: 2,
      nextOffset: 1,
    });
    pages["1"] = response({ anniversaries: [anniversary("b")], total: 2 });

    const wrapper = await mountPage();
    expect(wrapper.text()).not.toContain("Osoba b");

    await scrollToEnd(wrapper);

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(asked).toEqual([null, "1"]);
  });

  it("stops asking once the list says there is nothing behind it", async () => {
    pages.first = response({ anniversaries: [anniversary("a")], total: 1 });

    const wrapper = await mountPage();
    const status = await scrollToEnd(wrapper);

    // `empty` is what makes Vuetify stop firing the sentinel, so this is the
    // difference between a settled feed and one that requests forever.
    expect(status).toBe("empty");
    expect(asked).toEqual([null]);
  });

  it("asks once per page, not once per empty answer", async () => {
    // Unlike the home page's feed this endpoint slices a list it has already
    // computed, so a short page is the last page - there is nothing to retry.
    pages.first = response({
      anniversaries: [anniversary("a")],
      total: 2,
      nextOffset: 1,
    });
    pages["1"] = response({ anniversaries: [], total: 2 });

    const wrapper = await mountPage();

    expect(await scrollToEnd(wrapper)).toBe("empty");
    expect(asked).toEqual([null, "1"]);
  });

  it("stops loading by itself after two pages, and offers a button instead", async () => {
    // Otherwise the page has no bottom: every scroll towards the footer adds
    // another screen of cards above it, so the footer is never reached.
    pages.first = response({
      anniversaries: [anniversary("a")],
      total: 4,
      nextOffset: 1,
    });
    pages["1"] = response({
      anniversaries: [anniversary("b")],
      total: 4,
      nextOffset: 2,
    });
    pages["2"] = response({
      anniversaries: [anniversary("c")],
      total: 4,
      nextOffset: 3,
    });
    pages["3"] = response({ anniversaries: [anniversary("d")], total: 4 });

    const wrapper = await mountPage();
    const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });
    expect(scroll.props("mode")).toBe("intersect");

    await scrollToEnd(wrapper);
    expect(scroll.props("mode")).toBe("intersect");

    await scrollToEnd(wrapper);
    expect(scroll.props("mode")).toBe("manual");

    // Still loads on request - it is a button now, not a stop.
    expect(await scrollToEnd(wrapper)).toBe("empty");
    expect(wrapper.text()).toContain("Osoba d");
  });

  it("says so when there is nothing to show at all", async () => {
    pages.first = response();

    const wrapper = await mountPage();

    expect(
      wrapper.find('[data-testid="work-anniversaries-empty"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="work-anniversaries"]').exists()).toBe(
      false,
    );
  });

  it("labels the end of the feed in Polish, not Vuetify's English", async () => {
    pages.first = response({ anniversaries: [anniversary("a")], total: 1 });

    const wrapper = await mountPage();
    const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });

    expect(scroll.props("emptyText")).toBe(
      "To już wszystkie rocznice z tego okresu.",
    );
    expect(scroll.props("loadMoreText")).toBe("Pokaż więcej rocznic");
  });
});
