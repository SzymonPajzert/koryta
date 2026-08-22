import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
// Explicit: a test file gets none of the server auto-imports, so an endpoint
// handler that reaches for `getQuery` throws a ReferenceError, answers 500, and
// the component quietly treats it as an empty listing.
import { getQuery } from "h3";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EntityPicker from "../../../app/components/form/EntityPicker.vue";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).$fetch = mockFetch;

/** What the two endpoints answer with, set per test by `respondWith`. */
let searched: { id: string; name: string; type: string }[] = [];
type ListedNode = {
  /** Nullable on purpose: six articles on koryta.pl carry no headline and one
   * of them has no `name` field at all. */
  name?: string | null;
  visibility?: boolean;
  sourceURL?: string;
  shortName?: string;
};
let listedNodes: Record<string, ListedNode> = {};
/** Which kinds were asked for whole, so a test can say the listing happened. */
let askedForTypes: string[] = [];

registerEndpoint("/api/search", () => searched);
registerEndpoint("/api/nodes", (event) => {
  const type = getQuery(event).type as string | undefined;
  if (type) askedForTypes.push(type);
  return { nodes: listedNodes };
});

const vuetify = createVuetify({ components, directives });

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

function mountPicker(entity: unknown) {
  return mount(EntityPicker, {
    props: { entity, label: "Szukaj" },
    global: {
      plugins: [vuetify],
      stubs: { DialogProposeEditNode: true },
    },
    attachTo: document.body,
  });
}

/** Types a name and waits out the 300ms debounce, which is what gates both the
 * results and the "add to base" entries.
 *
 * Real time rather than fake timers: the debounce comes from @vueuse's
 * `refDebounced`, which vitest's fake clock does not drive, so the search never
 * ran and the list stayed empty while the add entries appeared anyway. */
async function searchFor(
  wrapper: ReturnType<typeof mountPicker>,
  term: string,
) {
  await wrapper.find("input").setValue(term);
  await new Promise((resolve) => setTimeout(resolve, 450));
  await flushPromises();
  await wrapper.vm.$nextTick();
}

const addEntries = () =>
  Array.from(
    document.querySelectorAll('[data-testid^="entity-picker-add-new-"]'),
  ).map((el) => el.getAttribute("data-testid"));

describe("EntityPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    mockFetch.mockResolvedValue([]);
    searched = [];
    listedNodes = {};
    askedForTypes = [];
  });

  it("offers to add a person the search could not find", async () => {
    const wrapper = mountPicker("person");
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Ktoś Nieznany");

    expect(addEntries()).toEqual(["entity-picker-add-new-person"]);
  });

  it("still offers to add one when several kinds are searched at once", async () => {
    // The relation composer on a person's page searches people, companies and
    // regions together. Offering nothing there left somebody who had just
    // failed to find a person with no way to add them - which is exactly when
    // they most need it.
    const wrapper = mountPicker(["person", "place", "region"]);
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Ktoś Nieznany");

    expect(addEntries()).toEqual([
      "entity-picker-add-new-person",
      "entity-picker-add-new-place",
    ]);
  });

  it("says which kind each entry would create, when there is a choice", async () => {
    const wrapper = mountPicker(["person", "place"]);
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Nowa Nazwa");

    expect(document.body.textContent).toContain("jako osobę.");
    expect(document.body.textContent).toContain("jako firmę lub instytucję.");
  });

  it("does not name the kind when there is only one", async () => {
    const wrapper = mountPicker("person");
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Nowa Nazwa");

    expect(document.body.textContent).toContain("do bazy.");
    expect(document.body.textContent).not.toContain("jako osobę.");
  });

  it("offers nothing to create where nothing may be", async () => {
    // A region has no schema /api/revisions/create would accept.
    const wrapper = mountPicker(["region"]);
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Nowy Region");

    expect(addEntries()).toEqual([]);
  });

  describe("kinds that are listed rather than searched", () => {
    /** `/api/search` matches on `nameChunksLower`, which a trigger writes for
     * people, places and regions only, and its query names those three types
     * outright. Articles and topics are therefore fetched whole.
     *
     * Served rather than stubbed: the component calls Nuxt's auto-imported
     * `$fetch`, which the `globalThis.$fetch` assignment above never
     * intercepted - the tests before this one pass because none of them reads
     * a response. */
    function respondWith(options: {
      search?: { id: string; name: string; type: string }[];
      nodes?: Record<string, ListedNode>;
    }) {
      searched = options.search ?? [];
      listedNodes = options.nodes ?? {};
    }

    it("lists topics, which the search index does not hold", async () => {
      respondWith({ nodes: { "topic-1": { name: "Powodzianie KRR" } } });

      const wrapper = mountPicker("topic");
      await wrapper.find("input").trigger("focus");
      await searchFor(wrapper, "Powodzianie");

      expect(askedForTypes).toContain("topic");
      expect(document.body.textContent).toContain("Powodzianie KRR");
    });

    it("searches and lists together when asked for a mix", async () => {
      // The regression this pins. `isSearchable` was false as soon as any
      // listed kind was among the types, so the search never ran and a picker
      // asked for people *and* topics returned topics only - which is exactly
      // what the composer on an article page asks for.
      respondWith({
        search: [{ id: "p1", name: "Jan Kowalski", type: "person" }],
        nodes: { "topic-1": { name: "Powodzianie KRR" } },
      });

      const wrapper = mountPicker(["person", "place", "topic"]);
      await wrapper.find("input").trigger("focus");
      await searchFor(wrapper, "Kowalski");

      // The searched kind answers, and the listed one was fetched too - it
      // contributes nothing here only because a name filter is applied to it
      // in the browser, which the next case shows working the other way.
      expect(document.body.textContent).toContain("Jan Kowalski");
      expect(askedForTypes).toContain("topic");
    });

    it("shows a listed match alongside a searched one", async () => {
      respondWith({
        search: [{ id: "p1", name: "Jan Powodzianin", type: "person" }],
        nodes: { "topic-1": { name: "Powodzianie KRR" } },
      });

      const wrapper = mountPicker(["person", "topic"]);
      await wrapper.find("input").trigger("focus");
      await searchFor(wrapper, "Powodzian");

      const rendered = document.body.textContent;
      expect(rendered).toContain("Jan Powodzianin");
      expect(rendered).toContain("Powodzianie KRR");
    });

    it("offers to create a topic nobody has named yet", async () => {
      respondWith({ nodes: {} });

      const wrapper = mountPicker("topic");
      await wrapper.find("input").trigger("focus");
      await searchFor(wrapper, "Nowa sprawa");

      expect(addEntries()).toEqual(["entity-picker-add-new-topic"]);
    });

    it("hides an unapproved entry from a logged out reader", async () => {
      respondWith({
        nodes: {
          "topic-1": { name: "Zatwierdzony" },
          "topic-2": { name: "Szkic", visibility: false },
        },
      });

      const wrapper = mountPicker("topic");
      await wrapper.find("input").trigger("focus");
      // A letter both names hold, so only the visibility filter can separate
      // them.
      await searchFor(wrapper, "z");

      const rendered = document.body.textContent;
      expect(rendered).toContain("Zatwierdzony");
      expect(rendered).not.toContain("Szkic");
    });

    describe("articles", () => {
      /** One of them has no headline at all, which is the state of the base:
       * a facebook post, a scan behind a `plik.php?id=`, and one article whose
       * `name` field is missing outright. */
      const nodes = {
        "art-1": {
          name: "Krzywda sędziego z Olsztyna",
          sourceURL:
            "https://olsztyn.wyborcza.pl/olsztyn/7,48726,32842906,krzywda-sedziego.html",
        },
        "art-2": {
          name: null,
          sourceURL: "https://bip.powiat.pruszkow.pl/plik.php?id=275783",
        },
      };

      it("finds an article by its headline", async () => {
        respondWith({ nodes });

        const wrapper = mountPicker("article");
        await wrapper.find("input").trigger("focus");
        await searchFor(wrapper, "sędziego");

        expect(askedForTypes).toContain("article");
        expect(document.body.textContent).toContain(
          "Krzywda sędziego z Olsztyna",
        );
      });

      it("keeps listing the others when one article has no name", async () => {
        // The regression this pins: the filter called `toLowerCase` on every
        // entry's name, so the one article with none threw on each render of
        // the picker and no term found anything at all.
        respondWith({ nodes });

        const wrapper = mountPicker("article");
        await wrapper.find("input").trigger("focus");
        await searchFor(wrapper, "Olsztyn");

        expect(document.body.textContent).toContain(
          "Krzywda sędziego z Olsztyna",
        );
      });

      it("calls a nameless article by its link", async () => {
        respondWith({ nodes });

        const wrapper = mountPicker("article");
        await wrapper.find("input").trigger("focus");
        await searchFor(wrapper, "plik.php");

        expect(document.body.textContent).toContain(
          "bip.powiat.pruszkow.pl/plik.php?id=275783",
        );
      });

      it("finds an article by a pasted link", async () => {
        // What comes off the address bar is not what was stored: `www.`, a
        // trailing slash, and the Polish letters spelled out rather than
        // percent-encoded.
        respondWith({
          nodes: {
            "art-3": {
              name: "Pełna lista absolwentów",
              sourceURL:
                "https://facebook.com/posts/pe%C5%82na-lista-absolwent%C3%B3w",
            },
          },
        });

        const wrapper = mountPicker("article");
        await wrapper.find("input").trigger("focus");
        await searchFor(
          wrapper,
          "https://www.facebook.com/posts/pełna-lista-absolwentów/",
        );

        expect(document.body.textContent).toContain("Pełna lista absolwentów");
      });

      it("tries the links only for a term that reads as one", async () => {
        // A slug holds the words of the headline, so matching every term
        // against it would answer "sad" with most of the base. Only something
        // with a slash or a dotted domain in it is taken for a link.
        respondWith({
          nodes: {
            "art-1": {
              name: "Zupełnie inna sprawa",
              sourceURL: "https://example.pl/sad-okregowy",
            },
          },
        });

        const wrapper = mountPicker("article");
        await wrapper.find("input").trigger("focus");
        await searchFor(wrapper, "okregowy");
        expect(document.body.textContent).not.toContain("Zupełnie inna sprawa");

        await searchFor(wrapper, "example.pl/sad-okregowy");
        expect(document.body.textContent).toContain("Zupełnie inna sprawa");
      });
    });
  });
});
