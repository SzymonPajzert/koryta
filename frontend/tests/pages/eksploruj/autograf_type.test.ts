import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AutografPage from "../../../../app/pages/eksploruj/autograf/[type].vue";
import { ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

// Mock vue-router explicitly since it's imported
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({ query: {}, params: { type: "spolki-partie" } }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), afterEach: vi.fn() }),
  };
});

// Mock Nuxt auto-imports
vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("useHead", vi.fn());

// Mock Composables
vi.mock("~~/app/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(() =>
    Promise.resolve({
      tableItems: ref([]),
      totalItems: ref(0),
      pending: ref(false),
    }),
  ),
}));
// Nuxt aliases it to ~ as well
vi.mock("~/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(() =>
    Promise.resolve({
      tableItems: ref([]),
      totalItems: ref(0),
      pending: ref(false),
    }),
  ),
}));

vi.mock("vuefire", () => ({
  useCurrentUser: vi.fn(() => ref(null)),
  useFirestore: vi.fn(() => ({})),
  useFirebaseAuth: vi.fn(() => ({})),
  useDocument: vi.fn(() => ref(null)),
}));

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

describe("AutografPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders correctly with empty data", async () => {
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
            ExploreLoginBanner: true,
            NuxtLink: NuxtLinkStub,
          },
        },
      },
    );

    await flushPromises();

    expect(wrapper.html()).toContain("Wizualizacje dla");
    expect(wrapper.html()).toContain("Wybierz wizualizację");
    // Since totalItems is 0, warning about limit should not be visible
    expect(wrapper.html()).not.toContain(
      "Zbyt wiele osób pasuje do aktualnych filtrów",
    );
  });
});
