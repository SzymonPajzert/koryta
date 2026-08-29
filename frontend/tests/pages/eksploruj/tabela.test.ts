import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import type { Query } from "~~/server/api/nodes/index.get";
import TabelaPage from "../../../app/pages/eksploruj/tabela.vue";

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

  it("asks for a person and their history in two columns", async () => {
    const wrapper = await mountPage();

    expect(headerTitles(wrapper)).toEqual([
      "Osoba",
      "Historia",
      "Lata pracy",
      "Notatki",
      "Głosy łącznie",
      "Twój głos",
      "Eksploruj",
    ]);
  });

  /** The regression that matters. The merged history column has to keep the
   * key of the date column it swallowed: `server/api/nodes/index.get.ts` has
   * no allow-list and hands an unrecognised `sortBy` straight to a Firestore
   * `orderBy`, which drops every document that does not carry the field. A
   * prettier key would answer an existing `?sortBy=latestEmploymentStart` link
   * with an empty table. */
  it("still sorts on latestEmploymentStart, and marks the Historia header", async () => {
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
    expect(sorted[0]!.text()).toContain("Historia");
    // ExploreTableColumnHeader hides the arrow with `opacity-0` on every
    // column that is not the sorted one.
    expect(sorted[0]!.find(".opacity-0").exists()).toBe(false);
  });

  it("keeps Widoczność behind being signed in", async () => {
    authUser.value = {
      getIdTokenResult: () => Promise.resolve({ claims: {} }),
    };

    const wrapper = await mountPage();

    expect(headerTitles(wrapper)).toContain("Widoczność");
    // ...and the merge is not undone for a signed-in reader either.
    expect(headerTitles(wrapper)).not.toContain("Partie");
  });
});
