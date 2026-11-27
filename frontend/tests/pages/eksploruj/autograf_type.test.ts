import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AutografPage from "../../../../app/pages/eksploruj/autograf/[type].vue";
import { ref } from "vue";
import type { Query } from "~~/server/api/nodes/index.get";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

// Live boxes, the way tests/pages/eksploruj/tabela.test.ts keeps them: `vi.mock`
// is hoisted above every declaration in this file, so a factory can only reach
// something hoisted with it.
const { routeQuery, routeType, lastQuery, lastOptions, routerReplace } =
  vi.hoisted(() => ({
    routerReplace: vi.fn(),
    routeQuery: { value: {} as Record<string, string> },
    routeType: { value: "spolki-partie" },
    lastQuery: { value: null as { value: Query } | null },
    lastOptions: { value: null as { enabled?: () => boolean } | null },
  }));

// Mock vue-router explicitly since it's imported
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({
      query: routeQuery.value,
      name: "eksploruj-autograf-type",
      path: `/eksploruj/autograf/${routeType.value}`,
      params: { type: routeType.value },
    }),
    useRouter: () => ({
      push: vi.fn(),
      replace: routerReplace,
      afterEach: vi.fn(),
    }),
  };
});

// Mock Nuxt auto-imports
vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("useHead", vi.fn());

// Mock Composables
vi.mock("~~/app/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(
    (apiQuery: { value: Query }, _key: string, options = {}) => {
      lastQuery.value = apiQuery;
      lastOptions.value = options;
      return Promise.resolve({
        tableItems: ref([]),
        totalItems: ref(0),
        pending: ref(false),
      });
    },
  ),
}));
// Nuxt aliases it to ~ as well
vi.mock("~/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(
    (apiQuery: { value: Query }, _key: string, options = {}) => {
      lastQuery.value = apiQuery;
      lastOptions.value = options;
      return Promise.resolve({
        tableItems: ref([]),
        totalItems: ref(0),
        pending: ref(false),
      });
    },
  ),
}));

vi.mock("vuefire", () => ({
  useCurrentUser: vi.fn(() => ref(null)),
  useFirestore: vi.fn(() => ({})),
  useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  useFirebaseAuth: vi.fn(() => ({})),
  useDocument: vi.fn(() => ref(null)),
}));

// `useAuthState` names the database it wants (`getFirestore(app, "koryta-pl")`)
// rather than taking vuefire's default-database handle, so the stub above is no
// longer enough on its own - the real `getFirestore` would reject the fake app.
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return { ...actual, getFirestore: vi.fn(() => ({})) };
});

vi.stubGlobal("useEntities", (type: string) => {
  if (type === "place") {
    return { entities: ref({}) };
  }
  if (type === "region") {
    return { entities: ref({}) };
  }
  return { entities: ref({}) };
});

// Mock NuxtLink component
const NuxtLinkStub = {
  template: "<a><slot /></a>",
};

async function mountPage(
  query: Record<string, string> = {},
  type = "spolki-partie",
) {
  routeQuery.value = query;
  routeType.value = type;
  lastQuery.value = null;
  lastOptions.value = null;

  const wrapper = mount(
    {
      components: { AutografPage },
      template: "<Suspense><AutografPage/></Suspense>",
    },
    {
      global: {
        plugins: [vuetify],
        stubs: {
          ClientOnly: { template: "<div><slot></slot></div>" },
          FormEksplorujTabelaFilters: true,
          ExploreVisualisationCompanies: true,
          ExploreVisualisationPartyStack: true,
          ExploreLoginBanner: true,
          NuxtLink: NuxtLinkStub,
        },
      },
    },
  );

  await flushPromises();
  return wrapper;
}

function currentQuery(): Query {
  if (!lastQuery.value) throw new Error("useListWithStats was never called");
  return lastQuery.value.value;
}

describe("AutografPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders correctly with empty data", async () => {
    const wrapper = await mountPage();

    expect(wrapper.html()).toContain("Wizualizacje dla");
    expect(wrapper.html()).toContain("Wybierz wizualizację");
    // Since totalItems is 0, warning about limit should not be visible
    expect(wrapper.html()).not.toContain(
      "Zbyt wiele osób pasuje do aktualnych filtrów",
    );
  });

  /** The bar draws „Typ podmiotu”, „Zatrudnieni od” and „Min. głosy łącznie”
   * whatever this page binds. Left unbound they wrote into the component's own
   * `defineModel` state, so picking „Szpitale” here made the button read
   * „Filtry (1)” while the chart under it was still drawn from an unfiltered
   * query and nothing on screen moved. */
  it("filters the chart by everything the bar offers", async () => {
    const wrapper = await mountPage({
      category: "szpitale",
      minEmploymentDate: "2020-01-01",
      minVotes: "5",
      teryt: "teryt14",
    });

    expect(currentQuery()).toMatchObject({
      category: "szpitale",
      minEmploymentDate: "2020-01-01",
      minVotes: 5,
      teryt: "teryt14",
    });
    // ...and the bar is told about them too, or its chips would describe a
    // narrower table than the one it is filtering.
    // The stub flattens every prop name to lower case.
    const bar = wrapper.find("form-eksploruj-tabela-filters-stub");
    expect(bar.attributes("category")).toBe("szpitale");
    expect(bar.attributes("minemploymentdate")).toBe("2020-01-01");
    expect(bar.attributes("minvotes")).toBe("5");
  });

  /** „Partie w czasie” reads its own endpoint and takes only its own
   * parameters, Polish ones (decision on 2026-11-27): the people query would be
   * two requests and their reads for nothing on screen, and the bar's filters
   * would narrow nothing. */
  it("hands „Partie w czasie” its Polish parameters and skips the people query", async () => {
    const wrapper = await mountPage(
      { kategoria: "szpitale", od: "2016", do: "2026", category: "koleje" },
      "partie-w-czasie",
    );

    expect(wrapper.find("h1").text()).toBe("Wizualizacje");
    expect(wrapper.find("form-eksploruj-tabela-filters-stub").exists()).toBe(
      false,
    );
    const chart = wrapper.find("explore-visualisation-party-stack-stub");
    expect(chart.exists()).toBe(true);
    // Its own `kategoria`, not the companies view's `category`.
    expect(chart.attributes("category")).toBe("szpitale");
    expect(chart.attributes("years")).toBe("2016,2026");
    expect(lastOptions.value?.enabled?.()).toBe(false);
  });

  it("writes both years at once, replacing the history entry", async () => {
    const wrapper = await mountPage(
      { kategoria: "szpitale" },
      "partie-w-czasie",
    );

    wrapper
      .findComponent({ name: "ExploreVisualisationPartyStack" })
      .vm.$emit("update:years", [2018, 2026]);
    await flushPromises();

    expect(routerReplace).toHaveBeenCalledWith({
      query: { kategoria: "szpitale", od: "2018", do: "2026" },
    });
  });

  it("fetches the people on the companies view", async () => {
    await mountPage();

    expect(lastOptions.value?.enabled?.()).toBe(true);
  });
});
