import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import OmniSearch from "../../app/components/OmniSearch.vue";
import { defineComponent, h, Suspense, nextTick, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { createRouter, createMemoryHistory } from "vue-router";

/** What /api/search answers with, set per test.
 *
 * Served rather than stubbed: the component calls Nuxt's auto-imported
 * `$fetch`, which the `vi.stubGlobal` below never intercepts. */
let searched: { id: string; name: string; type: string }[] = [];
registerEndpoint("/api/search", () => searched);

/** Who is signed in - nobody unless a test says so - and what
 * /api/search/facts answers them. `authRequest` is what attaches the token, so
 * it is the seam: a call to it at all is the thing a signed out reader must
 * never cause. */
const currentUser = ref<{ uid: string } | null>(null);
const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));
vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({ user: currentUser }),
  authRequest: mockAuthRequest,
}));

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
    currentUser.value = null;
    mockAuthRequest.mockReset();
    mockAuthRequest.mockResolvedValue({ names: [] });
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

  /** Piotr Ferster, whom three facts on Rafał Trzaskowski's page name and no
   * page of his own does. */
  const FERSTER = {
    name: "Piotr Ferster",
    facts: 3,
    people: [{ id: "8rg6", name: "Rafał Trzaskowski", facts: 3 }],
    morePeople: 0,
    articles: [],
    moreArticles: 0,
  };

  const texts = (el: Element | undefined, selector: string) =>
    Array.from(el?.querySelectorAll(selector) ?? []).map((node) =>
      node.textContent.trim(),
    );

  it("lists a name only the facts carry under a heading of its own, for a signed in reader", async () => {
    currentUser.value = { uid: "reader" };
    searched = [{ id: "p1", name: "Piotr Fersterski", type: "person" }];
    mockAuthRequest.mockResolvedValue({ names: [FERSTER] });
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "ferster");

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/search/facts", {
      method: "GET",
      query: { q: "ferster" },
    });

    const heading = document.querySelector(
      "[data-testid='omni-search-fact-names']",
    );
    expect(heading?.textContent.trim()).toBe("Wspomniani w faktach");

    // Under the people, not among them: the heading comes after the page the
    // search found, and the name after the heading.
    const menu = Array.from(
      document.querySelectorAll(".v-list-item, .v-list-subheader"),
    ).map((el) => el.textContent.trim());
    const page = menu.findIndex((text) => text === "Piotr Fersterski");
    const header = menu.indexOf("Wspomniani w faktach");
    expect(page).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(page);

    const row = document.querySelector("[data-testid='omni-search-fact-name']");
    expect(texts(row ?? undefined, ".v-list-item-title")).toEqual([
      "Piotr Ferster",
    ]);
    expect(texts(row ?? undefined, ".v-list-item-subtitle")).toEqual([
      "W faktach o: Rafał Trzaskowski",
    ]);

    wrapper.unmount();
  });

  it("finds it typed without its diacritics", async () => {
    // /api/search/facts folds them, and the menu's own filter must not throw
    // the hit away again on arrival.
    currentUser.value = { uid: "reader" };
    mockAuthRequest.mockResolvedValue({
      names: [{ ...FERSTER, name: "Żaneta Wspomniana" }],
    });
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "zaneta wsp");

    expect(
      texts(
        document.querySelector("[data-testid='omni-search-fact-name']") ??
          undefined,
        ".v-list-item-title",
      ),
    ).toEqual(["Żaneta Wspomniana"]);

    wrapper.unmount();
  });

  it("keeps a late answer out of a box that was cleared meanwhile", async () => {
    currentUser.value = { uid: "reader" };
    let answer: (value: unknown) => void = () => {};
    mockAuthRequest.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "ferster");
    await searchFor(wrapper, "");

    answer({ names: [FERSTER] });
    await flushPromises();

    expect(
      document.querySelector("[data-testid='omni-search-fact-name']"),
    ).toBeNull();

    wrapper.unmount();
  });

  it("does not ask for them for a reader who is not signed in", async () => {
    // The facts are behind the login, and so are the names in them.
    mockAuthRequest.mockResolvedValue({ names: [FERSTER] });
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "ferster");

    expect(mockAuthRequest).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-testid='omni-search-fact-names']"),
    ).toBeNull();

    wrapper.unmount();
  });

  it("does not list a name again that the people search found a page for", async () => {
    currentUser.value = { uid: "reader" };
    searched = [{ id: "p1", name: "Piotr Ferster", type: "person" }];
    mockAuthRequest.mockResolvedValue({ names: [FERSTER] });
    const wrapper = mountSearch();
    await flushPromises();
    await searchFor(wrapper, "ferster");

    expect(
      document.querySelector("[data-testid='omni-search-fact-names']"),
    ).toBeNull();
    expect(
      rows().filter((el) => el.textContent.includes("Piotr Ferster")),
    ).toHaveLength(1);

    wrapper.unmount();
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
