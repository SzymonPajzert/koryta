import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref, type Ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import PeopleList from "../../../app/components/card/PeopleList.vue";

const vuetify = createVuetify({ components, directives });

// The mock factories are hoisted above the `vue` import, so they hand out refs
// created below rather than making their own.
const state = vi.hoisted(() => ({
  list: undefined as
    | {
        tableItems: Ref<unknown[]>;
        totalItems: Ref<number>;
        pending: Ref<boolean>;
      }
    | undefined,
}));

// Nuxt aliases the composable under both roots.
vi.mock("~~/app/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(() => Promise.resolve(state.list)),
}));
vi.mock("~/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(() => Promise.resolve(state.list)),
}));

const listResult = {
  tableItems: ref<unknown[]>([]),
  totalItems: ref(0),
  pending: ref(false),
};
state.list = listResult;

vi.mock("vuefire", () => ({
  useCurrentUser: vi.fn(() => ref(null)),
  useFirestore: vi.fn(() => ({})),
  useFirebaseAuth: vi.fn(() => ({})),
}));

function mountCard() {
  return mount(
    {
      components: { PeopleList },
      // `region.people` deliberately disagrees with the list: it is the map's
      // precomputed, approved-only stat.
      template: `<Suspense><PeopleList :region="{ teryt: '1411', id: '1411', name: 'Powiat makowski', people: 1 }"/></Suspense>`,
    },
    {
      global: {
        plugins: [vuetify],
        stubs: { PartyChip: true, NuxtLink: { template: "<a><slot /></a>" } },
      },
    },
  );
}

describe("CardPeopleList", () => {
  it("counts the region link off the same query that fills the list", async () => {
    listResult.tableItems.value = [
      { id: "a", name: "Jan Kowalski", experience: 4 },
      { id: "b", name: "Anna Nowak", experience: 2 },
    ];
    listResult.totalItems.value = 2;

    const wrapper = mountCard();
    await flushPromises();

    expect(wrapper.text()).toContain("Jan Kowalski");
    expect(wrapper.text()).toContain("Anna Nowak");
    expect(wrapper.text()).toContain("(2 powiązania)");
    expect(wrapper.text()).not.toContain("(1 powiązanie)");
  });

  it("holds the count back until the list has loaded", async () => {
    listResult.tableItems.value = [];
    listResult.totalItems.value = 0;
    listResult.pending.value = true;

    const wrapper = mountCard();
    await flushPromises();

    expect(wrapper.text()).not.toContain("powiąza");
    listResult.pending.value = false;
  });

  it("lets the reader unpick the powiat from its header", async () => {
    listResult.tableItems.value = [];
    listResult.totalItems.value = 0;

    const wrapper = mountCard();
    await flushPromises();
    await wrapper.find('[data-testid="people-list-close"]').trigger("click");

    expect(wrapper.findComponent(PeopleList).emitted("close")).toHaveLength(1);
  });
});
