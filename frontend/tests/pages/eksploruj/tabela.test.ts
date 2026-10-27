import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import type { Query } from "~~/server/api/nodes/index.get";
import TabelaPage from "../../../app/pages/eksploruj/tabela.vue";
import ExploreTable from "../../../app/components/explore/Table.vue";

const vuetify = createVuetify({ components, directives });

// Same shape as tests/pages/eksploruj/nowe.test.ts: live boxes the tests
// rewrite between mounts, because `vi.mock` is hoisted above anything this
// file defines.
const { routeQuery, lastQuery, authUser } = vi.hoisted(() => ({
  routeQuery: { value: {} as Record<string, string> },
  lastQuery: { value: null as { value: Query } | null },
  authUser: { value: null as { getIdTokenResult: () => unknown } | null },
}));

// `mountSuspended` is not an option here: it brings Nuxt's own router, and the
// page reads and writes its whole filter state through `useRoute`/`useRouter`.
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({
      query: routeQuery.value,
      name: "eksploruj-tabela",
      path: "/eksploruj/tabela",
      params: {},
    }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), afterEach: vi.fn() }),
  };
});

// Records the query the page built and hands it an empty result set. Spelled
// out under both prefixes, the way nowe.test.ts does: Nuxt aliases the same
// composable twice and `vi.mock` matches on the specifier. Written out twice
// rather than shared through a local helper, because `vi.mock` is hoisted above
// every declaration in this file - a named factory is still in its temporal
// dead zone when the hoisted call runs.
vi.mock("~/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn((apiQuery: { value: Query }) => {
    lastQuery.value = apiQuery;
    return Promise.resolve({
      tableItems: ref([]),
      totalItems: ref(0),
      pending: ref(false),
    });
  }),
}));
vi.mock("~~/app/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn((apiQuery: { value: Query }) => {
    lastQuery.value = apiQuery;
    return Promise.resolve({
      tableItems: ref([]),
      totalItems: ref(0),
      pending: ref(false),
    });
  }),
}));

vi.mock("~/composables/edges", () => ({
  useEdges: vi.fn(() =>
    Promise.resolve({ sources: ref([]), targets: ref([]), refresh: vi.fn() }),
  ),
}));

// Auto-imported, so the page reaches them through the module Nuxt resolved at
// build time rather than through anything a `vi.stubGlobal` could reach.
vi.mock("~/composables/entity", () => ({
  useEntities: vi.fn(() => ({
    entities: ref({}),
    total: ref(0),
    refresh: vi.fn(),
  })),
}));
vi.mock("~/composables/companyLocations", () => ({
  useCompanyLocations: vi.fn(() => ({
    regions: ref({}),
    companyRegions: ref({}),
    companyLocations: ref({}),
  })),
}));

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
  routeQuery.value = query;
  lastQuery.value = null;

  vi.stubGlobal("definePageMeta", vi.fn());
  vi.stubGlobal("useHead", vi.fn());

  const wrapper = mount(
    {
      components: { TabelaPage },
      template: "<Suspense><TabelaPage/></Suspense>",
    },
    {
      global: {
        plugins: [vuetify],
        stubs: {
          ClientOnly: { template: "<div><slot></slot></div>" },
          ExploreNodeDrawer: true,
          ExploreSelectedCompanies: true,
          ExploreLoginBanner: true,
          ExploreProgressBar: true,
          FormEksplorujTabelaFilters: true,
          // Not stubbed: ExploreTable is what draws the header row these
          // tests are about.
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
}

const headerTitles = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll("thead th").map((cell) => cell.text().trim());

function currentQuery(): Query {
  if (!lastQuery.value) throw new Error("useListWithStats was never called");
  return lastQuery.value.value;
}

describe("/eksploruj/tabela's columns", () => {
  beforeEach(() => {
    lastQuery.value = null;
    authUser.value = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("asks for a person, their employers and their elections", async () => {
    const wrapper = await mountPage();

    // „Lata pracy” and „Notatki” are not here and are not meant to be: seven
    // days of api logs put them at under 4% of sorted queries between them, so
    // they live in the sort menus of the two columns that absorbed them.
    // „Eksploruj” is gone with them - the magnifier in it only opened the
    // drawer, which is what clicking the name does.
    expect(headerTitles(wrapper)).toEqual([
      "Osoba",
      "Firmy",
      "Wybory",
      "Oceny",
      "Twój głos",
    ]);
  });

  /** The other half of the sort-key hazard, and the one no header title makes
   * visible: `elections` and `userVote` are not keys the api maps onto a
   * Firestore path, so one click on a sortable „Wybory” would send
   * `?sortBy=elections` into an `orderBy` verbatim, drop every document that
   * carries no such field and answer with an empty table and no error. A whole
   * list rather than two negatives, so a column that quietly loses its sort
   * shows up here too. */
  it("only lets a reader sort on keys the api maps", async () => {
    const wrapper = await mountPage();

    const sortable = wrapper
      .findAll("thead th")
      .filter((cell) => cell.classes().includes("v-data-table__th--sortable"))
      .map((cell) => cell.text().trim());
    expect(sortable).toEqual(["Osoba", "Firmy", "Oceny"]);
  });

  /** The regression that matters. The merged history column has to keep the
   * key of the date column it swallowed: `server/api/nodes/index.get.ts` has
   * no allow-list and hands an unrecognised `sortBy` straight to a Firestore
   * `orderBy`, which drops every document that does not carry the field. A
   * prettier key would answer an existing `?sortBy=latestEmploymentStart` link
   * with an empty table. Renaming the column to „Firmy” does not touch it. */
  it("still sorts on latestEmploymentStart, and marks the Firmy header", async () => {
    const wrapper = await mountPage({
      sortBy: "latestEmploymentStart",
      sortDesc: "true",
    });

    expect(currentQuery()).toMatchObject({
      sortBy: "latestEmploymentStart",
      sortDesc: "true",
    });

    const sorted = wrapper.findAll("th.v-data-table__th--sorted");
    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.text()).toContain("Firmy");
    // ExploreTableColumnHeader hides the arrow with `opacity-0` on every
    // column that is not the sorted one.
    expect(sorted[0]!.find(".opacity-0").exists()).toBe(false);
  });

  /** The share card offers „Dołącz stronę i liczbę wierszy” only where ticking
   * it would change the address, and it can only see what the bar hands it: the
   * bar's own `query` carries no paging, so with nothing passed here the
   * checkbox compared a link against itself and never appeared at all.
   *
   * The row count goes up only once the reader has changed it. `shareUrl` drops
   * `page=1` by itself but has no default to compare a row count against, so
   * the untouched first page would otherwise offer to add `itemsPerPage=10` -
   * which is what the recipient gets anyway. */
  it("tells the bar where in the results the reader is standing", async () => {
    const paged = await mountPage({ page: "3", itemsPerPage: "100" });

    // The stub flattens every prop name to lower case.
    const bar = paged.find("form-eksploruj-tabela-filters-stub");
    expect(bar.attributes("page")).toBe("3");
    expect(bar.attributes("itemsperpage")).toBe("100");

    const fresh = await mountPage();
    const freshBar = fresh.find("form-eksploruj-tabela-filters-stub");
    expect(freshBar.attributes("page")).toBe("1");
    expect(freshBar.attributes("itemsperpage")).toBeUndefined();
  });

  /** „Widoczność” was the last of the count-style columns, and a two-value
   * flag is a badge's job: the Osoba cell marks a draft with „szkic” and says
   * nothing about the nine rows in ten that are published. Nothing changes for
   * a guest, who was never offered the column at all. */
  it("folds Widoczność into the Osoba cell for a signed-in reader", async () => {
    authUser.value = {
      getIdTokenResult: () => Promise.resolve({ claims: {} }),
    };

    const wrapper = await mountPage();

    expect(headerTitles(wrapper)).not.toContain("Widoczność");
    // ...and the merge is not undone for a signed-in reader either.
    expect(headerTitles(wrapper)).not.toContain("Partie");
    expect(wrapper.findComponent(ExploreTable).props("draftWithName")).toBe(
      true,
    );
  });

  it("leaves the badge off for a guest, whose rows are all published", async () => {
    const wrapper = await mountPage();

    expect(wrapper.findComponent(ExploreTable).props("draftWithName")).toBe(
      false,
    );
  });

  /** Dropping the column must not drop the sort behind it. `visibility` maps
   * onto `stats.isApproved` in server/api/nodes/index.get.ts and is still in
   * `tableSortOptions`, which is what the query bar builds its sort menu from -
   * so a signed-in reader can still order by it, and a link somebody already
   * shared still works with no header left to click. */
  it("still orders by visibility when a link asks for it", async () => {
    authUser.value = {
      getIdTokenResult: () => Promise.resolve({ claims: {} }),
    };

    const wrapper = await mountPage({
      sortBy: "visibility",
      sortDesc: "true",
    });

    expect(currentQuery()).toMatchObject({
      sortBy: "visibility",
      sortDesc: "true",
    });
    // No column claims it, and none may pretend to: the arrow belongs to the
    // sort button on the query bar now.
    expect(wrapper.findAll("th.v-data-table__th--sorted")).toHaveLength(0);
    // And the bar is told who is reading, which is what puts „Status” in that
    // menu (`adminOnly` in shared/queryUrl.ts).
    expect(
      wrapper
        .find("form-eksploruj-tabela-filters-stub")
        .attributes("showvisibility"),
    ).toBe("true");
  });

  /** The url is the filter's whole state: a shared link carrying elections
   * has to reach the api, and the rows have to know which runs to fill. */
  it("asks for the elections a link names, and has the rows mark them", async () => {
    const wrapper = await mountPage({ election: "parliament-2023" });

    expect(currentQuery().election).toEqual(["parliament-2023"]);
    expect(
      wrapper.findComponent(ExploreTable).props("matchedElections"),
    ).toEqual(["parliament-2023"]);

    const unfiltered = await mountPage();
    expect(currentQuery().election).toBeUndefined();
    expect(
      unfiltered.findComponent(ExploreTable).props("matchedElections"),
    ).toBeNull();
  });
});
