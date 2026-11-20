import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import {
  mockNuxtImport,
  mountSuspended,
  registerEndpoint,
} from "@nuxt/test-utils/runtime";
import { defineComponent, h, type PropType } from "vue";
import IndexPage from "../../app/pages/index.vue";
import type { DeclarationPeople } from "../../shared/declarations";
import { SEEDED_DECLARATION_PEOPLE as seededPeople } from "../../scripts/declarationPeople";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** What the page asks the head for. Hoisted, as mockNuxtImport is. */
const { seoMeta } = vi.hoisted(() => ({ seoMeta: vi.fn() }));
mockNuxtImport("useSeoMeta", () => seoMeta);

/** The night's people count the page fetches for the explorer's third
 * panel: null before the job's first night. */
let people: DeclarationPeople | null = null;
registerEndpoint("/api/declarations/people", () => ({ people }));

/** Says what the page handed the explorer, in place of the map and charts. */
const ExplorerStub = defineComponent({
  name: "HomeExplorer",
  props: {
    people: { type: Object as PropType<object | null>, default: null },
  },
  setup: (props) => () =>
    h("div", {
      "data-explorer": "",
      "data-people": props.people ? "yes" : "no",
    }),
});

const mount = (route = "/") =>
  mountSuspended(IndexPage, {
    route,
    global: {
      stubs: {
        HomeExplorer: ExplorerStub,
        HomeEventFeed: true,
        CardCallToAction: true,
        MailNewsletterSignupForm: true,
        OmniSearch: true,
        "omni-search": true,
      },
    },
  });

beforeEach(() => {
  people = null;
  // useFetch keeps the answer under its key between mounts.
  clearNuxtData("declarations-people");
});

describe("IndexPage", () => {
  it("renders correctly", async () => {
    const wrapper = await mount();
    await flushPromises();
    expect(wrapper.html()).not.toContain("fallback");
    expect(wrapper.html()).toContain(
      "Jesteśmy największym, ogólnopolskim i niezależnym agregatorem",
    );
  });

  it("hands the explorer the night's people count", async () => {
    people = seededPeople as DeclarationPeople;
    const wrapper = await mount();
    await flushPromises();
    expect(wrapper.get("[data-explorer]").attributes("data-people")).toBe(
      "yes",
    );
  });

  it("keeps a linked panel in og:url, where a shared link is taken from", async () => {
    // Facebook takes og:url as a post's link: without `?widok=` the people it
    // reaches would land on a random panel. The canonical stays `/`.
    await mount("/?widok=stanowiska");
    expect(seoMeta.mock.calls.at(-1)?.[0].ogUrl).toMatch(
      /^https?:\/\/[^/]+\/\?widok=stanowiska$/,
    );

    await mount("/?widok=wykres");
    expect(seoMeta.mock.calls.at(-1)?.[0].ogUrl).toBeUndefined();

    await mount("/");
    expect(seoMeta.mock.calls.at(-1)?.[0].ogUrl).toBeUndefined();
  });

  it("keeps the explorer at two panels before the first count", async () => {
    const wrapper = await mount();
    await flushPromises();
    expect(wrapper.get("[data-explorer]").attributes("data-people")).toBe("no");
  });
});
