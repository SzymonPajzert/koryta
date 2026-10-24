import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { ref, type Ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import PeopleList from "../../../app/components/card/PeopleList.vue";
import type { Powiat } from "../../../app/composables/entity/regions";
import type { RegionStat } from "../../../server/utils/regionStats";

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
  counts: undefined as
    { data: Ref<RegionStat[]>; status: Ref<string> } | undefined,
}));

// Nuxt aliases the composable under both roots.
vi.mock("~~/app/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(() => Promise.resolve(state.list)),
}));
vi.mock("~/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn(() => Promise.resolve(state.list)),
}));

// The counts the list of powiaty is drawn from, before anything is picked.
// Mocked for the same reason the people are: this file mounts outside a Nuxt
// app, where `useFetch` has nothing to run in. RegionsTop.test.ts is where
// the list itself is tested against the endpoint.
vi.mock("~~/app/composables/stats/useRegionCounts", () => ({
  useRegionCounts: vi.fn(() => state.counts),
}));
vi.mock("~/composables/stats/useRegionCounts", () => ({
  useRegionCounts: vi.fn(() => state.counts),
}));

const listResult = {
  tableItems: ref<unknown[]>([]),
  totalItems: ref(0),
  pending: ref(false),
};
state.list = listResult;

state.counts = {
  data: ref<RegionStat[]>([
    { id: "teryt2261", teryt: "2261", name: "Gdańsk", people: 117 },
    { id: "teryt1465", teryt: "1465", name: "Miasto Warszawa", people: 518 },
  ]),
  status: ref("success"),
};

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

/** Warszawa as its row picks it: the node's name, „Miasto” and all. */
const WARSZAWA: Powiat = {
  teryt: "1465",
  id: "1465",
  d: "",
  people: 518,
  name: "Miasto Warszawa",
};

const wrappers: { unmount: () => void }[] = [];

afterEach(() => {
  // Attached to the document for the focus checks, so taken out of it again
  // rather than left to answer the next test's queries.
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

/** The card as the explorer holds it: the region it was handed, the pick a
 * row passes up and the way back both written into it, as `HomeExplorer`
 * does. Attached, so where focus lands can be read off the document. */
function mountInExplorer(region?: Powiat) {
  const wrapper = mount(
    {
      components: { PeopleList },
      data: () => ({ region }),
      template: `<Suspense><PeopleList :region="region" @pick="region = $event" @reset="region = undefined"/></Suspense>`,
    },
    {
      attachTo: document.body,
      global: {
        plugins: [vuetify],
        stubs: { PartyChip: true, NuxtLink: { template: "<a><slot /></a>" } },
      },
    },
  );
  wrappers.push(wrapper);
  return wrapper;
}

const regionRows = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-testid="home-region-row"]');

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

  it("captions a person with whole years of work", async () => {
    // It printed the raw figure before a fixed noun: „21.8 lat pracy”, and
    // „4 lat pracy” for a whole number that wants „lata”.
    listResult.tableItems.value = [
      { id: "a", name: "Jan Kowalski", experience: 21.8 },
      { id: "b", name: "Anna Nowak", experience: 4 },
      { id: "c", name: "Ewa Zielińska", experience: 0.4 },
    ];
    listResult.totalItems.value = 3;

    const wrapper = mountCard();
    await flushPromises();

    const captions = wrapper
      .findAll(".v-list-item-subtitle")
      .map((subtitle) => subtitle.text());
    expect(captions).toEqual(
      expect.arrayContaining([
        "22 lata pracy",
        "4 lata pracy",
        "poniżej roku pracy",
      ]),
    );
    expect(wrapper.text()).not.toContain("21.8");
  });

  it("lists the powiaty with the most people until one is picked", async () => {
    const wrapper = mountInExplorer();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-side-panel"]').exists()).toBe(true);
    expect(
      regionRows(wrapper).map((row) => row.get(".v-list-item-title").text()),
    ).toEqual(["Warszawa", "Gdańsk"]);
    // No card for a region nobody has picked: no way back, nothing to see.
    expect(wrapper.find('[data-testid="home-region-reset"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("Zobacz cały region");
  });

  it("passes a row's powiat up, to be picked as a click on the map is", async () => {
    const wrapper = mountInExplorer();
    await flushPromises();

    await regionRows(wrapper)[0]!.trigger("click");

    expect(wrapper.findComponent(PeopleList).emitted("pick")).toEqual([
      [WARSZAWA],
    ]);
  });

  it("opens the powiat a row picks, and lands the reader on it", async () => {
    listResult.tableItems.value = [];
    listResult.totalItems.value = 0;
    const wrapper = mountInExplorer();
    await flushPromises();

    await regionRows(wrapper)[0]!.trigger("click");
    await flushPromises();

    const title = wrapper.get(".people-list__title");
    expect(title.text()).toBe("Miasto Warszawa");
    // A keyboard reader who picked the row is moved to what it opened, not
    // left on a row that is no longer there.
    expect(document.activeElement).toBe(title.element);
    const seeAll = wrapper
      .findAllComponents({ name: "VListItem" })
      .find((item) => item.props("title") === "Zobacz cały region");
    expect(seeAll?.props("to")).toBe("/eksploruj/tabela?teryt=1465");
  });

  it("goes back from a picked powiat to the list, to the row it left", async () => {
    const wrapper = mountInExplorer(WARSZAWA);
    await flushPromises();

    const reset = wrapper.get('[data-testid="home-region-reset"]');
    expect(reset.attributes("aria-label")).toBe("Wróć do listy powiatów");
    await reset.trigger("click");
    await flushPromises();

    expect(wrapper.findComponent(PeopleList).emitted("reset")).toHaveLength(1);
    expect(wrapper.find('[data-testid="home-side-panel"]').exists()).toBe(true);
    expect(wrapper.find(".people-list__title").exists()).toBe(false);
    expect(document.activeElement).toBe(regionRows(wrapper)[0]!.element);
  });
});
