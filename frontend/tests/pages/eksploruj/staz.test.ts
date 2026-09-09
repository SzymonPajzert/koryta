import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData, useRouter } from "#app";
import StazPage from "../../../app/pages/eksploruj/staz.vue";
import type {
  ServiceMilestone,
  ServiceMilestones as Response,
} from "../../../server/api/edges/serviceMilestones.get";

/** The pages the endpoint will hand out, keyed by the offset that asks for
 * them. The first page asks for none. */
let pages: Record<string, Response> = {};

/** Every offset the page asked for, in order, so a test can say it never asked
 * twice for the same slice. */
const asked: (string | null)[] = [];

/** Every half the page asked for, in order, so a test can say the toggle
 * refetched rather than filtering what was already on screen. */
const askedScopes: string[] = [];

registerEndpoint("/api/edges/serviceMilestones", (event) => {
  const params = new URL(event.node.req.url ?? "/", "http://test").searchParams;
  const offset = params.get("offset") ?? null;
  const scope = params.get("scope") ?? "upcoming";
  asked.push(offset);
  askedScopes.push(scope);
  const key = offset === null ? `first:${scope}` : offset;
  return (
    pages[key] ??
    pages[offset ?? "first"] ?? {
      milestones: [],
      scope,
      total: 0,
      upcoming: 0,
      past: 0,
      nextOffset: null,
      today: "2026-09-09",
    }
  );
});

function milestone(
  id: string,
  fields: Partial<ServiceMilestone> = {},
): ServiceMilestone {
  return {
    id,
    personId: `p-${id}`,
    personName: `Osoba ${id}`,
    parties: [],
    years: 10,
    date: "2026-09-09",
    daysFromToday: 0,
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    alsoHeld: 0,
    institutions: 1,
    spells: 1,
    projected: true,
    ...fields,
  };
}

function response(fields: Partial<Response> = {}): Response {
  return {
    milestones: [],
    scope: "upcoming",
    total: 0,
    upcoming: 0,
    past: 0,
    nextOffset: null,
    today: "2026-09-09",
    ...fields,
  };
}

/** Every wrapper this file has mounted, so `afterEach` can take them down.
 *
 * `mountSuspended` leaves a page mounted for the lifetime of the file, and
 * this one watches the route: resetting the query in `beforeEach` made every
 * still-live wrapper flip its half back and refetch, which showed up as a
 * phantom first-page request in the *next* test's `asked`. */
const mounted: { unmount: () => void }[] = [];

async function mountPage() {
  const wrapper = await mountSuspended(StazPage);
  mounted.push(wrapper);
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="service-milestones"]').exists() ||
      wrapper.find('[data-testid="service-milestones-empty"]').exists(),
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

describe("eksploruj/staz", () => {
  beforeEach(async () => {
    asked.length = 0;
    askedScopes.length = 0;
    pages = {};
    // One Nuxt app serves the whole file, so the toggle's `?zakres=minione`
    // outlives the test that clicked it and the next mount would open on the
    // wrong half.
    await useRouter().replace({ query: {} });
  });

  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    // One Nuxt app serves the whole file, so the first page the previous test
    // fetched is still in the payload and the next mount would re-serve it
    // without asking for anything.
    clearNuxtData();
  });

  it("draws a card for every milestone on the first page", async () => {
    pages.first = response({
      milestones: [milestone("a"), milestone("b")],
      total: 2,
      upcoming: 2,
    });

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(wrapper.find('[data-testid="service-milestones"]').exists()).toBe(
      true,
    );
  });

  it("opens on the upcoming half", async () => {
    // The half a reader came for. In calendar order across the whole window it
    // sat behind every milestone that had already gone by.
    pages.first = response({
      milestones: [milestone("a", { daysFromToday: 3 })],
      total: 194,
      upcoming: 194,
      past: 177,
      nextOffset: 1,
    });

    const wrapper = await mountPage();

    expect(askedScopes[0]).toBe("upcoming");
    expect(wrapper.find('[data-testid="milestones-summary"]').text()).toBe(
      "194 osoby z okrągłym stażem w najbliższym miesiącu",
    );
  });

  it("counts both halves on the toggle, not just the one on screen", async () => {
    pages.first = response({
      milestones: [milestone("a", { daysFromToday: 3 })],
      total: 194,
      upcoming: 194,
      past: 177,
    });

    const wrapper = await mountPage();
    const toggle = wrapper.find('[data-testid="milestones-scope"]');

    expect(toggle.text()).toContain("Nadchodzące");
    expect(toggle.text()).toContain("(194)");
    expect(toggle.text()).toContain("Minione");
    expect(toggle.text()).toContain("(177)");
  });

  it("refetches the other half rather than filtering what is on screen", async () => {
    // The two halves are different slices of a list the endpoint holds, and
    // only the requested one is ever sent - so the toggle has to ask.
    pages["first:upcoming"] = response({
      milestones: [milestone("soon", { daysFromToday: 3 })],
      total: 1,
      upcoming: 1,
      past: 1,
    });
    pages["first:past"] = response({
      milestones: [milestone("gone", { daysFromToday: -3 })],
      scope: "past",
      total: 1,
      upcoming: 1,
      past: 1,
    });

    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Osoba soon");

    await wrapper.find('[data-testid="scope-past"]').trigger("click");
    await vi.waitUntil(() => wrapper.text().includes("Osoba gone"), {
      timeout: 2000,
    });

    expect(askedScopes).toEqual(["upcoming", "past"]);
    // Replaced, not appended: the other half is a different feed.
    expect(wrapper.text()).not.toContain("Osoba soon");
    expect(wrapper.find('[data-testid="milestones-summary"]').text()).toBe(
      "1 osoba z okrągłym stażem w minionym miesiącu",
    );
  });

  it("appends the next page rather than replacing what is on screen", async () => {
    pages.first = response({
      milestones: [milestone("a")],
      total: 2,
      nextOffset: 1,
    });
    pages["1"] = response({ milestones: [milestone("b")], total: 2 });

    const wrapper = await mountPage();
    expect(wrapper.text()).not.toContain("Osoba b");

    await scrollToEnd(wrapper);

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(asked).toEqual([null, "1"]);
  });

  it("stops asking once the list says there is nothing behind it", async () => {
    pages.first = response({ milestones: [milestone("a")], total: 1 });

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
      milestones: [milestone("a")],
      total: 2,
      nextOffset: 1,
    });
    pages["1"] = response({ milestones: [], total: 2 });

    const wrapper = await mountPage();

    expect(await scrollToEnd(wrapper)).toBe("empty");
    expect(asked).toEqual([null, "1"]);
  });

  it("stops loading by itself after two pages, and offers a button instead", async () => {
    // Otherwise the page has no bottom: every scroll towards the footer adds
    // another screen of cards above it, so the footer is never reached.
    pages.first = response({
      milestones: [milestone("a")],
      total: 4,
      nextOffset: 1,
    });
    pages["1"] = response({
      milestones: [milestone("b")],
      total: 4,
      nextOffset: 2,
    });
    pages["2"] = response({
      milestones: [milestone("c")],
      total: 4,
      nextOffset: 3,
    });
    pages["3"] = response({ milestones: [milestone("d")], total: 4 });

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
      wrapper.find('[data-testid="service-milestones-empty"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="service-milestones"]').exists()).toBe(
      false,
    );
  });

  it("labels the end of the feed in Polish, not Vuetify's English", async () => {
    pages.first = response({ milestones: [milestone("a")], total: 1 });

    const wrapper = await mountPage();
    const scroll = wrapper.findComponent({ name: "VInfiniteScroll" });

    expect(scroll.props("emptyText")).toBe(
      "To już wszystkie okrągłe staże z tego okresu.",
    );
    expect(scroll.props("loadMoreText")).toBe("Pokaż więcej");
  });
});
