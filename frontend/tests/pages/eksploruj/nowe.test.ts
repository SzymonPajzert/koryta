import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { computed, reactive, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import type { Query } from "~~/server/api/nodes/index.get";
import NowePage from "../../../app/pages/eksploruj/nowe.vue";

const vuetify = createVuetify({ components, directives });

// Every page reads the one route the router mock holds, so a page left
// mounted would go on writing into the next test's url.
enableAutoUnmount(afterEach);

// The route is what the filters and the person on screen are read from, so it
// is a live object: the router's push and replace write into it, and a test
// rewrites it to stand for the back button.
const { route, router, calls, items, queueAnswer, authUser } = vi.hoisted(
  () => {
    const route = {
      current: null as null | {
        query: Record<string, string>;
        name: string;
        path: string;
        params: Record<string, string>;
      },
    };
    const navigate = vi.fn(async (to: { query: Record<string, string> }) => {
      route.current!.query = { ...to.query };
    });
    return {
      route,
      router: {
        push: navigate,
        replace: vi.fn(async (to: { query: Record<string, string> }) => {
          route.current!.query = { ...to.query };
        }),
      },
      // What each list the page sets up was asked, by its cache key: the
      // queue is "nowe-data", the person the url names "nowe-shown".
      calls: new Map<
        string,
        { query: { value: Query }; options: { enabled?: () => boolean } }
      >(),
      // What the queue answers with. Empty unless a test asks for a focused
      // person, because most of them only look at the query it built.
      items: { value: [] as Record<string, unknown>[] },
      // Or, for the tests that page through it, a person per question.
      queueAnswer: {
        value: null as null | ((query: Query) => Record<string, unknown>[]),
      },
      // Who is signed in, for the controls that only an admin is offered. A
      // hoisted box rather than a fixed mock return, because `vi.mock` is
      // lifted above anything this file defines and the tests need to change
      // it.
      authUser: { value: null as { getIdTokenResult: () => unknown } | null },
    };
  },
);

/** The route every page reads, made reactive on first use: the mocks below
 * are lifted above the imports, so they cannot call `reactive` themselves. */
function currentRoute() {
  route.current ??= reactive({
    query: {},
    name: "eksploruj-nowe",
    path: "/eksploruj/nowe",
    params: {},
  });
  return route.current;
}

/** What the page asked of the tab. */
const head = vi.hoisted(() => vi.fn());
mockNuxtImport("useHead", () => head);

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => currentRoute(),
    useRouter: () => ({
      push: router.push,
      replace: router.replace,
      afterEach: vi.fn(),
    }),
  };
});

/** The lists, answered on the spot: the queue from `queueAnswer` or `items`,
 * the person the url names with a row of their own. Records what each was
 * asked. Spelled out for both prefixes because Nuxt aliases the same
 * composable under each. */
async function fakeLists(
  importOriginal: () => Promise<
    typeof import("~/composables/entity/listWithStats")
  >,
) {
  const actual = await importOriginal();
  return {
    ...actual,
    useListWithStats: vi.fn(
      (
        apiQuery: { value: Query },
        key: string,
        options: { enabled?: () => boolean } = {},
      ) => {
        calls.set(key, { query: apiQuery, options });
        const enabled = () => options.enabled?.() ?? true;
        const rows = computed(() => {
          if (!enabled()) return [];
          if (key === "nowe-shown") {
            const id = apiQuery.value.id;
            return id ? [{ id, name: `Osoba ${id}`, type: "person" }] : [];
          }
          return queueAnswer.value
            ? queueAnswer.value(apiQuery.value)
            : items.value;
        });
        return Promise.resolve({
          tableItems: rows,
          totalItems: computed(() => rows.value.length),
          pending: ref(false),
          status: ref("success"),
          answeredQuery: computed(() =>
            enabled() ? actual.queryKey(apiQuery.value) : undefined,
          ),
        });
      },
    ),
  };
}
vi.mock("~/composables/entity/listWithStats", fakeLists);
vi.mock("~~/app/composables/entity/listWithStats", fakeLists);

// Auto-imported, so a `vi.stubGlobal` would not be consulted: the page reaches
// them through the module Nuxt resolved at build time.
vi.mock("~/composables/companyLocations", () => ({
  useCompanyLocations: vi.fn(() => ({
    companyRegions: ref({}),
    companyLocations: ref({}),
    regions: ref({}),
  })),
}));

// `useAuthState` names the database it wants rather than taking vuefire's
// default-database handle, so the vuefire stub below is not enough on its own.
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return { ...actual, getFirestore: vi.fn(() => ({})) };
});

vi.mock("vuefire", () => ({
  useCurrentUser: vi.fn(() => computed(() => authUser.value)),
  useFirestore: vi.fn(() => ({})),
  useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  useFirebaseAuth: vi.fn(() => ({})),
  useDocument: vi.fn(() => ref(null)),
}));

async function mountPage(query: Record<string, string> = {}) {
  currentRoute().query = { ...query };
  calls.clear();

  vi.stubGlobal("definePageMeta", vi.fn());
  vi.stubGlobal("useHead", vi.fn());
  vi.stubGlobal("useCookie", (_key: string, opts: { default: () => boolean }) =>
    ref(opts.default()),
  );

  const wrapper = mount(
    { components: { NowePage }, template: "<Suspense><NowePage/></Suspense>" },
    {
      global: {
        plugins: [vuetify],
        stubs: {
          ClientOnly: { template: "<div><slot></slot></div>" },
          ExploreProgressBar: true,
          ExploreTable: true,
          // The person's own page, which fetches everything it draws.
          EntityDetailView: true,
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
}

/** What the queue was asked. */
function currentQuery(): Query {
  const queue = calls.get("nowe-data");
  if (!queue) throw new Error("the queue was never set up");
  return queue.query.value;
}

describe("/eksploruj/nowe", () => {
  beforeEach(() => {
    items.value = [];
    queueAnswer.value = null;
    authUser.value = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("defaults to the most recently employed above the minimum score", async () => {
    const wrapper = await mountPage();

    expect(currentQuery()).toMatchObject({
      sortBy: "latestEmploymentStart",
      sortDesc: "true",
      hideVoted: "no_votes",
      minVotes: 3,
    });
    expect(wrapper.text()).toContain("Najnowsze zatrudnienia");
    expect(
      (wrapper.find('input[type="number"]').element as HTMLInputElement).value,
    ).toBe("3");
  });

  it("takes the minimum score from the url", async () => {
    await mountPage({ minVotes: "1" });

    expect(currentQuery().minVotes).toBe(1);
  });

  it("sorts by the vote total and drops the minimum in the votes mode", async () => {
    const wrapper = await mountPage({ order: "votes", minVotes: "1" });

    const query = currentQuery();
    expect(query.sortBy).toBe("stats.votes.interesting");
    expect(query.minVotes).toBeUndefined();
    // The threshold only means something for the recent queue, so its field
    // goes away with it.
    expect(wrapper.find('input[type="number"]').exists()).toBe(false);
  });

  it("narrows the queue to the tier the url asks for", async () => {
    // Where the cards on /pomoc land. The score floor goes with it: the tier
    // is already a shortlist, and a reader who picked one there asked for its
    // people, not for the highly-rated subset of them.
    const wrapper = await mountPage({ tier: "1" });

    expect(currentQuery()).toMatchObject({ queueTier: 1, minVotes: 0 });
    expect(wrapper.text()).toContain("Tylko poziom 1");
  });

  it("asks for no tier at all when the url names none", async () => {
    // Absent rather than 0: `queueTier: 0` is a real tier value - the people
    // nothing can be checked against - and asking for it would empty the
    // default queue.
    await mountPage();

    expect(currentQuery().queueTier).toBeUndefined();
  });

  it("advances the queue by at least one person", async () => {
    const wrapper = await mountPage();

    expect(currentQuery().page).toBe(1);
    // The step is random, so several contributors working the same queue do
    // not all land on the same person - but never zero, which used to leave
    // the reader where they were on a tenth of the clicks.
    for (let click = 0; click < 25; click++) {
      const before = currentQuery().page as number;
      await wrapper.get('[data-testid="next-person"]').trigger("click");
      expect(currentQuery().page as number).toBeGreaterThan(before);
    }
  });

  it("ticks the three steps off rather than listing five instructions", async () => {
    const wrapper = await mountPage();

    const steps = wrapper.get('[data-testid="explore-steps"]');
    expect(steps.findAll("li.step").map((s) => s.text())).toEqual([
      "1Eksploruj",
      "2Notatka",
      "3Głos",
    ]);
    expect(steps.findAll("li.step--done")).toHaveLength(0);

    // The long version is one click away rather than open on the page.
    expect(steps.text()).toContain("Jak to działa?");
  });

  /** The long version, side by side rather than stacked. One column per step,
   * left to right in the strip's order and carrying the strip's badges - a
   * stacked list said nothing about which of the three numbers each paragraph
   * belonged to. */
  it("explains the three steps in columns, in the order of the strip", async () => {
    const wrapper = await mountPage();

    const steps = wrapper.get('[data-testid="explore-steps"]');
    const details = steps.findAll("li.detail");
    expect(details.map((detail) => detail.get(".detail__head").text())).toEqual(
      ["1Eksploruj", "2Notatka", "3Głos"],
    );
    // Each column holds its own step's explanation, not just its heading.
    expect(
      details.map((detail) => detail.text().includes("Kliknij „Eksploruj”")),
    ).toEqual([true, false, false]);
    // The columns are not `li.step`: that class is the strip, and the
    // assertion above it counts on there being exactly three of them.
    expect(steps.findAll("li.step")).toHaveLength(3);
  });

  /** The table spilled out of its card because it declared eleven columns
   * against a 1248px card, three of which this page already says elsewhere.
   * The list is asserted whole rather than by absence: a column added back
   * without a look at the width is exactly how the spill happened. */
  it("asks for five columns, not the eleven that did not fit", async () => {
    const wrapper = await mountPage();

    const keys = (
      wrapper.findComponent({ name: "ExploreTable" }).props("headers") as {
        key: string;
      }[]
    ).map((header) => header.key);

    expect(keys).toEqual([
      "name",
      "latestEmploymentStart",
      "experience",
      "userVote",
      "explore",
    ]);
    // "Notatki" duplicates the NoteEditor further down, "Widoczność" reads
    // "Szkic" on every row of a `visibility=private` queue, and "Głosy
    // łącznie" moved under the name.
    expect(keys).not.toContain("notesCount");
    expect(keys).not.toContain("stats.votes.interesting");
    expect(keys).not.toContain("visibility");
  });

  /** The „Lata pracy” column, drawn by Vuetify itself.
   *
   * explore/Table.vue has no `item.experience` slot and suppresses its own
   * rounded caption on a page that declares this column, so the header's
   * `value` function is the only thing between the row and the raw figure
   * `shared/stats.ts` computes. Rendered through a real data table rather than
   * called directly: a Vuetify release that stopped consulting `value` would
   * put „12.4” back on the page and pass a test that only called the function.
   */
  async function experienceCell(
    headers: Record<string, unknown>[],
    experience: number,
  ) {
    const table = mount(
      {
        props: ["headers", "items"],
        // `mobile` off: below 1280px Vuetify prints the column title into the
        // cell as well, which is the width happy-dom reports.
        template: `<v-data-table-server
          :headers="headers"
          :items="items"
          :items-length="items.length"
          :mobile="false"
          hide-default-footer
        />`,
      },
      {
        props: {
          headers,
          items: [{ id: "person-1", name: "Testowa Osoba", experience }],
        },
        global: { plugins: [vuetify] },
      },
    );
    await flushPromises();

    const cells = table.findAll("tbody td");
    expect(cells).toHaveLength(headers.length);
    return cells[2]!.text();
  }

  it("prints whole years in the „Lata pracy” column, not 12.4", async () => {
    const wrapper = await mountPage();
    const headers = wrapper
      .findComponent({ name: "ExploreTable" })
      .props("headers") as Record<string, unknown>[];

    expect(await experienceCell(headers, 12.4)).toBe("12");
    expect(await experienceCell(headers, 1.6)).toBe("2");
    // Rounding on its own would answer four months of work with „0”, a row
    // saying this person has never worked anywhere.
    expect(await experienceCell(headers, 0.4)).toBe("poniżej roku");
    // Nothing known, nothing printed - „0” would be a claim.
    expect(await experienceCell(headers, 0)).toBe("");
  });

  /** "Widoczność" used to be pushed onto the list for anybody signed in, and
   * this page is behind the auth middleware - so every reader had it. */
  it("does not bring Widoczność back for a signed-in reader", async () => {
    authUser.value = {
      getIdTokenResult: () => Promise.resolve({ claims: { admin: true } }),
    };

    const wrapper = await mountPage();

    const keys = (
      wrapper.findComponent({ name: "ExploreTable" }).props("headers") as {
        key: string;
      }[]
    ).map((header) => header.key);

    expect(keys).toEqual([
      "name",
      "latestEmploymentStart",
      "experience",
      "userVote",
      "explore",
    ]);
  });

  it("asks the table to print the score under the name instead", async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.findComponent({ name: "ExploreTable" }).props("scoreWithName"),
    ).toBe(true);
  });

  /** /eksploruj/tabela replaced its „Widoczność” column with a „szkic” badge
   * in the name cell, in the shared table both pages mount. This queue
   * hardcodes `visibility: "private"`, so that badge would be on every row it
   * ever draws - which is the column it deleted, one word shorter. */
  it("does not take the draft badge instead", async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.findComponent({ name: "ExploreTable" }).props("draftWithName"),
    ).toBe(false);
  });

  /** The person the queue is on, drawn by their own page rather than by cards
   * built for the queue - those kept falling behind the profile. */
  it("shows the person's own page under the table", async () => {
    items.value = [{ id: "person-1", name: "Testowa Osoba", type: "person" }];
    const wrapper = await mountPage();

    const view = wrapper.findComponent({ name: "EntityDetailView" });
    expect(view.props()).toMatchObject({ node: "person-1", type: "person" });
    const html = wrapper.html();
    expect(html.indexOf("entity-detail-view-stub")).toBeGreaterThan(
      html.indexOf("explore-table-stub"),
    );
  });

  it("draws no page while the queue is empty", async () => {
    const wrapper = await mountPage();

    expect(wrapper.findComponent({ name: "EntityDetailView" }).exists()).toBe(
      false,
    );
  });

  it("ticks „Notatka” and „Głos” off on what the reader does on the page", async () => {
    items.value = [{ id: "person-1", name: "Testowa Osoba", type: "person" }];
    const wrapper = await mountPage();

    const view = wrapper.findComponent({ name: "EntityDetailView" });
    view.vm.$emit("noted");
    view.vm.$emit("voted");
    await flushPromises();

    const steps = wrapper.get('[data-testid="explore-steps"]');
    expect(steps.findAll("li.step--done").map((s) => s.text())).toEqual([
      "Notatka",
      "Głos",
    ]);
  });

  /** The page under the table names the tab after the person, as it does on
   * the profile. The tab belongs to the queue. */
  it("keeps the queue's title on the tab", async () => {
    await mountPage();

    expect(head).toHaveBeenCalledWith(
      { title: "Eksploruj Nowe" },
      { tagPriority: "high" },
    );
  });
});

/** The person on screen is in the url, so the back button returns to the one
 * before and a reload or a link opens the same one. */
describe("/eksploruj/nowe keeps the person in the url", () => {
  beforeEach(() => {
    items.value = [];
    authUser.value = null;
    // One person per place in the queue: p1 first, p2 second, and in the
    // other order v1, v2.
    queueAnswer.value = (query) => [
      {
        id: `${query.sortBy === "latestEmploymentStart" ? "p" : "v"}${query.page}`,
        name: `Osoba ${query.page}`,
        type: "person",
      },
    ];
    // „Następna osoba” steps by a random one to five places; one here.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const shown = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
    wrapper.findComponent({ name: "EntityDetailView" }).props("node");

  it("names whoever the queue opens on, in place of the address", async () => {
    const wrapper = await mountPage({ minVotes: "1" });

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith({
      query: { minVotes: "1", osoba: "p1" },
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(shown(wrapper)).toBe("p1");
    // The queue's own row, not a second read of the same person.
    expect(calls.get("nowe-shown")!.options.enabled!()).toBe(false);
  });

  it("adds a history entry for „Następna osoba”", async () => {
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="next-person"]').trigger("click");
    await flushPromises();

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ query: { osoba: "p2" } });
    expect(route.current!.query).toEqual({ osoba: "p2" });
    expect(shown(wrapper)).toBe("p2");
  });

  it("shows the person before after the back button, read on their own", async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="next-person"]').trigger("click");
    await flushPromises();

    // What the router does on the back button.
    route.current!.query = { osoba: "p1" };
    await flushPromises();

    expect(shown(wrapper)).toBe("p1");
    expect(calls.get("nowe-shown")!.query.value).toEqual({
      type: "person",
      limit: 1,
      id: "p1",
    });
    expect(calls.get("nowe-shown")!.options.enabled!()).toBe(true);
    // The queue stays where the reader got to, and nothing was written.
    expect(currentQuery().page).toBe(2);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledTimes(1);

    // „Następna osoba” from there goes on from the queue, not from p1.
    await wrapper.get('[data-testid="next-person"]').trigger("click");
    await flushPromises();
    expect(route.current!.query).toEqual({ osoba: "p3" });
    expect(shown(wrapper)).toBe("p3");
  });

  it("opens the person a link or a reload names", async () => {
    const wrapper = await mountPage({ osoba: "p9" });

    expect(shown(wrapper)).toBe("p9");
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("drops the person when a filter changes, and names the new head", async () => {
    const wrapper = await mountPage();
    expect(route.current!.query).toEqual({ osoba: "p1" });

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Najwyżej oceniane"))!
      .trigger("click");
    await flushPromises();

    // The filter's own entry, without the person it named...
    expect(router.push).toHaveBeenCalledWith({ query: { order: "votes" } });
    // ...who is then the head of the new queue, in place.
    expect(router.replace).toHaveBeenLastCalledWith({
      query: { order: "votes", osoba: "v1" },
    });
    expect(shown(wrapper)).toBe("v1");
  });

  it("leaves the url naming nobody once the queue runs out", async () => {
    queueAnswer.value = (query) =>
      query.page === 1 ? [{ id: "p1", name: "Osoba 1", type: "person" }] : [];
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="next-person"]').trigger("click");
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith({ query: {} });
    expect(wrapper.findComponent({ name: "EntityDetailView" }).exists()).toBe(
      false,
    );
  });

  it("starts the steps again for the next person", async () => {
    const wrapper = await mountPage();
    wrapper.findComponent({ name: "EntityDetailView" }).vm.$emit("voted");
    await flushPromises();
    const steps = () =>
      wrapper
        .get('[data-testid="explore-steps"]')
        .findAll("li.step--done")
        .map((step) => step.text());
    expect(steps()).toEqual(["Głos"]);

    await wrapper.get('[data-testid="next-person"]').trigger("click");
    await flushPromises();

    expect(steps()).toEqual([]);
  });
});
