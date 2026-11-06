import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import OmniSearch from "../../app/components/OmniSearch.vue";
import { defineComponent, h, Suspense, nextTick } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { createRouter, createMemoryHistory } from "vue-router";
import { getQuery, readBody } from "h3";
import { trackGoal } from "~/composables/analytics";
import { noteSearchPick } from "~/composables/teaserJourney";

vi.mock("~/composables/analytics", () => ({ trackGoal: vi.fn() }));
vi.mock("~/composables/teaserJourney", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/teaserJourney")>()),
  noteSearchPick: vi.fn(),
}));

/** Who is reading: nobody unless a test signs somebody in. Read at the moment
 * the box reports, so a plain holder is enough. */
const reader = vi.hoisted(() => ({
  value: null as { uid: string; getIdToken: () => Promise<string> } | null,
}));
vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useCurrentUser: () => reader,
}));

/** What /api/search answers with, set per test.
 *
 * Served rather than stubbed: the component calls Nuxt's auto-imported
 * `$fetch`, which the `vi.stubGlobal` below never intercepts. */
let searched: {
  id: string;
  name: string;
  type: string;
  published?: boolean;
  query?: Record<string, string>;
}[] = [];
/** What the box asked the server, in order. */
let asked: string[] = [];
registerEndpoint("/api/search", (event) => {
  asked.push(String(getQuery(event).q));
  return searched;
});

/** What the box sent to the site's own log, in order, and the token each went
 * with - the server works out from it whether somebody was signed in. Read
 * off the web headers, which ignore case: the stub's Node request keeps the
 * `Authorization` the box wrote, where `getHeader` looks for it lowercased. */
let logged: { body: Record<string, unknown>; authorization?: string }[] = [];
registerEndpoint("/api/search/log", {
  method: "POST",
  handler: async (event) => {
    logged.push({
      body: await readBody(event),
      authorization: event.headers.get("authorization") ?? undefined,
    });
    return { recorded: true };
  },
});

// The menu is a real overlay here, and Vuetify measures it on open.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
global.visualViewport = {
  width: 1024,
  height: 768,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as VisualViewport;

const vuetify = createVuetify({
  components,
  directives,
});

// Mock useAsyncData for graph (default empty)
vi.stubGlobal("useAsyncData", () => ({
  data: {
    value: {
      nodeGroups: [],
      nodes: {},
    },
  },
}));

vi.stubGlobal("$fetch", vi.fn());

// Mock useAuthState
vi.stubGlobal("useAuthState", () => ({
  idToken: { value: "test-token" },
  authFetch: () => ({
    data: {
      value: {
        nodeGroups: [
          { id: "group1", name: "Group 1", stats: { people: 10 } },
          { id: "group2", name: "Group 2", stats: { people: 5 } },
        ],
        nodes: {
          person1: { type: "circle", name: "Person 1" },
          place1: { type: "rect", name: "Place 1" },
        },
      },
    },
    refresh: vi.fn(),
  }),
}));

describe("OmniSearch", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    searched = [];
    asked = [];
    logged = [];
    reader.value = null;
    vi.mocked(trackGoal).mockClear();
    vi.mocked(noteSearchPick).mockClear();
  });

  // Setup Router
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div>Home</div>" } },
      {
        path: "/entity/place/:id",
        component: { template: "<div>Place</div>" },
      },
    ],
  });

  it("renders correctly and has items", async () => {
    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      {
        global: {
          plugins: [vuetify, router],
        },
      },
    );

    await flushPromises();
    expect(wrapper.find("input").exists()).toBe(true);

    // We can also trigger search
    const input = wrapper.find("input");
    await input.setValue("Person");

    // Or that search, still waiting out the debounce, runs in a later test -
    // and is settled there by whatever navigates next.
    wrapper.unmount();
  });

  it("keeps a hit whose middle name sits between the words typed", async () => {
    // Vuetify filters the menu again on the client, and its own filter wants
    // the query to appear in the title as one substring - which threw away the
    // result the server had just been taught to find. Two of every five people
    // in the database carry a middle name, so this was the whole bug on its
    // own. Read off the prop rather than the rendered menu: the menu lives in
    // a teleport that only exists once the field is focused, and what is worth
    // pinning here is which filter the field was handed.
    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      { global: { plugins: [vuetify, router] } },
    );

    await flushPromises();

    const filter = wrapper
      .findComponent({ name: "VAutocomplete" })
      .props("customFilter") as (value: string, query: string) => boolean;

    expect(filter("Andrzej Józef Namysło", "Andrzej Namysło")).toBe(true);
    expect(filter("Andrzej Józef Namysło", "Andrzej N")).toBe(true);
    // Still narrows the party rows, which never go near the server.
    expect(filter("PO", "PO")).toBe(true);
    expect(filter("PiS", "PO")).toBe(false);
    expect(filter("Anna Nowak", "Andrzej Namysło")).toBe(false);

    wrapper.unmount();
  });

  it("keeps a company by the word in its quotes, and by the KRS number it was found by", async () => {
    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      { global: { plugins: [vuetify, router] } },
    );

    await flushPromises();

    const filter = wrapper
      .findComponent({ name: "VAutocomplete" })
      .props("customFilter") as (
      value: string,
      query: string,
      item?: { raw?: { krsNumber?: string } },
    ) => boolean;

    const pgk = 'PRZEDSIĘBIORSTWO GOSPODARKI KOMUNALNEJ "SANIKOM" (Lubawka)';
    expect(filter(pgk, "sanikom lubawka")).toBe(true);
    expect(filter('STADNINA KONI "KRASNE"', "stadnina koni krasne")).toBe(true);
    // No name holds the number: only the hit the server found by it is kept.
    expect(
      filter(pgk, "0000029741", { raw: { krsNumber: "0000029741" } }),
    ).toBe(true);
    expect(filter(pgk, "0000029741", { raw: {} })).toBe(false);
    expect(
      filter(pgk, "0000029742", { raw: { krsNumber: "0000029741" } }),
    ).toBe(false);

    wrapper.unmount();
  });

  /** The register name that started this: 97 characters, and the search box
   * used to show the first 40 of them. */
  const LONG_NAME =
    "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ WOJEWÓDZKI SZPITAL SPECJALISTYCZNY NR 3 W RYBNIKU";

  const mountSearch = () =>
    mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      // Attached, because the menu is teleported: detached, the rows exist
      // nowhere this test could read them.
      { global: { plugins: [vuetify, router] }, attachTo: document.body },
    );

  /** Types a query and waits out the 300ms debounce that gates the results.
   *
   * Real time rather than fake timers: the debounce is @vueuse's
   * `refDebounced`, which vitest's clock does not drive - the search would
   * never run and the menu would stay on the client-side entries. */
  const searchFor = async (
    wrapper: ReturnType<typeof mountSearch>,
    term: string,
  ) => {
    // Focused first: the menu is what carries the rows, and VAutocomplete only
    // opens it for a field that has focus.
    await wrapper.find("input").trigger("focus");
    await wrapper.find("input").setValue(term);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flushPromises();
    await wrapper.vm.$nextTick();
  };

  const rows = () =>
    Array.from(document.querySelectorAll<HTMLElement>(".v-list-item"));

  it("shows a long name in full instead of clipping it", async () => {
    // Vuetify clips `.v-list-item-title` to one line with an ellipsis, and the
    // index is full of 90-character register names - so every hospital's row
    // read the same „SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ…” and no
    // two of them could be told apart.
    searched = [{ id: "szpital-1", name: LONG_NAME, type: "place" }];
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "szpital");

    const title = document.querySelector(".v-list-item-title");
    expect(title?.textContent.trim()).toBe(LONG_NAME);
    expect(title?.classList.contains("text-wrap")).toBe(true);
    // The row used to carry a 400px cap as well, which cut a wrapped name off
    // just as effectively as the ellipsis did.
    expect(rows()[0]?.style.maxWidth).toBe("");

    wrapper.unmount();
  });

  it("writes the name once per row", async () => {
    // The slot still spreads Vuetify's own item props, `title` among them. Left
    // in, VListItem renders its title element as well as the one written here
    // and the name shows up twice in the row.
    searched = [{ id: "szpital-1", name: LONG_NAME, type: "place" }];
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "szpital");

    const row = rows().find((el) => el.textContent.includes(LONG_NAME));
    expect(row?.querySelectorAll(".v-list-item-title")).toHaveLength(1);

    wrapper.unmount();
  });

  it("keeps a party's subtitle under its name", async () => {
    // Handed to VListItem as the `subtitle` prop it would render above a name
    // that comes from the default slot, leaving „Partia” on top of „PO”.
    searched = [];
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "PO");

    const party = rows().find(
      (el) =>
        el.querySelector(".v-list-item-title")?.textContent.trim() === "PO",
    );
    const lines = Array.from(
      party?.querySelectorAll(".v-list-item-title, .v-list-item-subtitle") ??
        [],
    ).map((el) => el.textContent.trim());
    expect(lines).toEqual(["PO", "Partia"]);

    wrapper.unmount();
  });

  it("draws an unpublished person like any other hit", async () => {
    // Whose page is a teaser is the page's to explain, not the search box's
    // to label: no "unpublished" under the name.
    searched = [
      { id: "live", name: "Anna Nowakowska", type: "person", published: true },
      { id: "draft", name: "Anna Nowak", type: "person", published: false },
    ];
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "anna nowak");

    const row = (name: string) =>
      rows().find(
        (el) =>
          el.querySelector(".v-list-item-title")?.textContent.trim() === name,
      );
    expect(row("Anna Nowak")).toBeDefined();
    expect(
      row("Anna Nowak")?.querySelector(".v-list-item-subtitle"),
    ).toBeNull();
    expect(row("Anna Nowakowska")).toBeDefined();

    wrapper.unmount();
  });

  /** The search:settled events sent so far. */
  const settled = () =>
    vi
      .mocked(trackGoal)
      .mock.calls.filter(([goal]) => goal === "search:settled")
      .map(([, props]) => props);

  it("reports the search a logged out reader left, once, to both places", async () => {
    // The search that found nothing is the one most worth knowing about - a
    // name the site does not have - and it is reported once, not once for
    // every prefix the box asked the server about on the way.
    searched = [];
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "Zofia");
    await searchFor(wrapper, "Zofia  Zielińska");
    await searchFor(wrapper, "");
    await flushPromises();

    expect(settled()).toEqual([
      {
        query: "zofia zielińska",
        results: "none",
        unverified: "none",
        outcome: "abandon",
      },
    ]);
    // The site's own copy has the counts themselves, and no token to go by.
    expect(logged).toEqual([
      {
        body: {
          query: "zofia zielińska",
          results: 0,
          unverified: 0,
          outcome: "abandon",
        },
        authorization: undefined,
      },
    ]);

    wrapper.unmount();
  });

  it("keeps a signed in reader's searches on the site, not on Plausible", async () => {
    // Their searches are their research, and the owner's would outnumber
    // every reader's in Plausible. The site keeps them, marked as such.
    reader.value = { uid: "contributor", getIdToken: async () => "token" };
    searched = [];
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "Zofia Zielińska");
    await searchFor(wrapper, "");
    await flushPromises();

    // The search itself went out - with the token - and was answered.
    expect(
      vi
        .mocked(trackGoal)
        .mock.calls.some(([goal]) => goal === "search:performed"),
    ).toBe(true);
    expect(settled()).toEqual([]);
    expect(logged).toEqual([
      {
        body: {
          query: "zofia zielińska",
          results: 0,
          unverified: 0,
          outcome: "abandon",
        },
        authorization: "Bearer token",
      },
    ]);

    wrapper.unmount();
  });

  it("keeps what a reader opened with the search that found it", async () => {
    // A reader who opened an unpublished person wanted them and got a teaser:
    // the review queue, in the order readers ask for it.
    searched = [
      { id: "draft", name: "Anna Nowak", type: "person", published: false },
    ];
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "Anna Nowak");

    const autocomplete = wrapper.findComponent({ name: "VAutocomplete" });
    const hit = (autocomplete.props("items") as { nodeId?: string }[]).find(
      (item) => item.nodeId === "draft",
    );
    expect(hit).toBeDefined();
    autocomplete.vm.$emit("update:modelValue", hit);
    await flushPromises();

    expect(logged.map(({ body }) => body)).toEqual([
      {
        query: "anna nowak",
        results: 1,
        unverified: 1,
        outcome: "pick",
        picked: "person",
        pickedUnverified: true,
      },
    ]);
    // Plausible hears what was opened from search:pick, so not here as well.
    expect(settled()).toEqual([
      {
        query: "anna nowak",
        results: "1-4",
        unverified: "all",
        outcome: "pick",
      },
    ]);

    wrapper.unmount();
  });

  describe("after a pick", () => {
    /** Nuxt's router, the one the box reaches for, rather than the one mounted
     * above. Answered without moving, so that every pick here behaves like
     * „Lista wszystkich osób” on the table, which goes nowhere: a reset that
     * waited for the route to change would never come. */
    let push: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      push = vi.spyOn(useRouter(), "push").mockResolvedValue(undefined);
    });
    afterEach(() => {
      push.mockRestore();
    });

    /** Clicks a row the way a reader does. Through VAutocomplete's own
     * `select()`, because that is what writes the title into the field, and
     * emitting `update:modelValue` at it would skip the half under test. */
    const pick = async (title: string) => {
      const row = rows().find(
        (el) =>
          el.querySelector(".v-list-item-title")?.textContent.trim() === title,
      );
      expect(row, `no row for ${title}`).toBeDefined();
      row!.click();
      await flushPromises();
    };

    /** Past the debounce of `search` and the timer behind it, both of which
     * could still answer the pick with a search or a report of their own. */
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 750));
      await flushPromises();
    };

    const expectEmptyBox = (wrapper: ReturnType<typeof mountSearch>) => {
      const autocomplete = wrapper.findComponent({ name: "VAutocomplete" });
      expect(wrapper.find("input").element.value).toBe("");
      expect(autocomplete.props("modelValue")).toBeNull();
      expect(autocomplete.props("search")).toBeFalsy();
      // The label VAutocomplete draws for a selection, beside the input.
      expect(wrapper.find(".v-autocomplete__selection-text").exists()).toBe(
        false,
      );
    };

    /** The search:pick events sent so far. */
    const picks = () =>
      vi
        .mocked(trackGoal)
        .mock.calls.filter(([goal]) => goal === "search:pick")
        .map(([, props]) => props);

    it.each([
      {
        entry: "the list of everybody",
        typed: "lista",
        title: "Lista wszystkich osób",
        kind: "list",
        target: { path: "/eksploruj/tabela", query: {} },
      },
      {
        entry: "a party",
        typed: "konfederacja",
        title: "Konfederacja",
        kind: "party",
        target: { path: "/eksploruj/tabela", query: { party: "Konfederacja" } },
      },
      {
        entry: "a region",
        typed: "opole",
        title: "Opole",
        kind: "region",
        target: { path: "/eksploruj/tabela", query: { teryt: "1661" } },
      },
    ])(
      "empties the box after $entry, and does each thing a pick does once",
      async ({ typed, title, kind, target }) => {
        // On the table none of these replaces the box, and the first of them
        // does not even change the url. The label stayed in the field and the
        // next click turned it into text, so a reader looking for somebody
        // typed into it: „Lista wszystkich ospaób”, and nothing was found.
        searched = [
          {
            id: "teryt1661",
            name: "Opole",
            type: "region",
            query: { teryt: "1661" },
          },
        ];
        const wrapper = mountSearch();
        await flushPromises();
        await searchFor(wrapper, typed);

        await pick(title);
        expectEmptyBox(wrapper);

        await settle();
        expectEmptyBox(wrapper);
        expect(picks()).toEqual([{ kind }]);
        expect(push).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenCalledWith(target);
        expect(noteSearchPick).toHaveBeenCalledTimes(1);
        // The title never gets as far as the server, and neither the emptied
        // box nor its debounce settles the search a second time.
        expect(asked).toEqual([typed]);
        expect(logged.map(({ body }) => body.outcome)).toEqual(["pick"]);
        expect(settled()).toHaveLength(1);

        wrapper.unmount();
      },
    );

    it("takes a name typed straight after a pick as a new search", async () => {
      searched = [{ id: "anna", name: "Anna Nowak", type: "person" }];
      const wrapper = mountSearch();
      await flushPromises();
      await searchFor(wrapper, "lista");
      await pick("Lista wszystkich osób");

      await searchFor(wrapper, "anna");

      expect(wrapper.find("input").element.value).toBe("anna");
      expect(asked).toEqual(["lista", "anna"]);
      expect(rows().some((el) => el.textContent.includes("Anna Nowak"))).toBe(
        true,
      );
      // Its own search, not thrown away with the answers the pick ended.
      await searchFor(wrapper, "");
      expect(logged.map(({ body }) => [body.query, body.outcome])).toEqual([
        ["lista", "pick"],
        ["anna", "abandon"],
      ]);

      wrapper.unmount();
    });

    it("counts picking the same entry again as another pick", async () => {
      // VAutocomplete does not report a value it already holds, so as long as
      // the pick stayed in the box the second one did nothing at all.
      const wrapper = mountSearch();
      await flushPromises();

      await searchFor(wrapper, "lista");
      await pick("Lista wszystkich osób");
      await wrapper.find("input").trigger("keydown", { key: "ArrowDown" });
      await flushPromises();
      await pick("Lista wszystkich osób");
      await settle();

      expect(picks()).toHaveLength(2);
      expect(push).toHaveBeenCalledTimes(2);
      expect(noteSearchPick).toHaveBeenCalledTimes(2);
      // One search, however many times it was acted on.
      expect(logged).toHaveLength(1);
      expectEmptyBox(wrapper);

      wrapper.unmount();
    });
  });

  it.skip("redirects to place for 'rect' nodes", async () => {
    // Spy on router push
    const pushSpy = vi.spyOn(router, "push");
    // Clear calls from previous tests/mounts
    pushSpy.mockClear();

    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      {
        global: {
          plugins: [vuetify, router],
        },
      },
    );

    await flushPromises();

    // Simulate item selection which OmniSearch handles via watcher on model
    const autocomplete = wrapper.findComponent({ name: "VAutocomplete" });
    expect(autocomplete.exists()).toBe(true);

    await autocomplete.emit("update:modelValue", {
      title: "Place 1",
      path: "/entity/place/place1",
      analyticsKind: "place",
    });

    await nextTick();
    await nextTick();

    // Check call
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/entity/place/place1",
      }),
    );
  });
});
