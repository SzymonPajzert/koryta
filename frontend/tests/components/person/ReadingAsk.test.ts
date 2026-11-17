import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import { ref } from "vue";
import PersonReadingAsk from "../../../app/components/person/ReadingAsk.vue";
import { trackGoal } from "~/composables/analytics";
import type { PersonDeclarations } from "../../../shared/declarations";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: ref(null) }),
}));
vi.mock("~/composables/analytics", () => ({ trackGoal: vi.fn() }));

// The ask counts itself shown from an IntersectionObserver, which happy-dom
// does not have: this one hands its callback to the test, which says when the
// ask came into view.
let reportInView: ((entries: { isIntersecting: boolean }[]) => void) | null =
  null;
global.IntersectionObserver = class {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    reportInView = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/** What /api/stats/activity says the automation published in 30 days. */
let automatic = 741;
registerEndpoint("/api/stats/activity", () => ({ automatic }));

/** Published by the automation, so on the readers' readings. */
const readersPublished: PersonDeclarations = {
  autoPublished: { at: "2026-11-01T08:15:00.000Z" },
  declarations: [
    {
      url: "https://bip.example.pl/oswiadczenie-2024.pdf",
      year: 2024,
      unit: "Strzelin (gmina miejsko-wiejska)",
      office: "Rada gminy",
    },
  ],
};

/** The declarations endpoint, by node; a node not named answers 404. */
function declarations(byNode: Record<string, PersonDeclarations>) {
  mockAuthRequest.mockImplementation(async (url: string) => {
    const node = /^\/api\/nodes\/([^/]+)\/declarations$/.exec(url)?.[1];
    const found = node ? byNode[node] : undefined;
    if (found) return found;
    throw Object.assign(new Error("Page not found"), { statusCode: 404 });
  });
}

/** The words as a reader reads them: no-break spaces are spaces. */
const words = (text: string) =>
  text.replaceAll(String.fromCharCode(0xa0), " ").replace(/\s+/g, " ").trim();

async function mount(nodeId: string) {
  const ask = await mountSuspended(PersonReadingAsk, { props: { nodeId } });
  await flushPromises();
  return ask;
}

// Each test asks for its own node: the declarations are keyed by it.
describe("PersonReadingAsk", () => {
  beforeEach(() => {
    vi.mocked(trackGoal).mockClear();
    clearNuxtData("person-reading-ask-figure");
    automatic = 741;
    reportInView = null;
    declarations({ nauto: readersPublished });
  });

  it("leads with the people the readings published, and asks for a few scans", async () => {
    const ask = await mount("nplain");

    expect(
      words(ask.get('[data-testid="person-reading-ask-figure"]').text()),
    ).toBe("741 opublikowanych osób");
    expect(ask.get("h3").text()).toBe("Masz minutę?");
    expect(words(ask.text())).toContain(
      "Przepisz daty urodzenia z kilku skanów oświadczeń. Jeśli będą pasować do danych z KRS-u, automatycznie opublikujemy te osoby.",
    );
    const go = ask.get('[data-testid="person-reading-ask-go"]');
    expect(go.text()).toBe("Odczytaj skany");
    // Off the props, not `href`: with no router mounted a `v-btn` with a `to`
    // renders an `<a>` with no href at all (as CallToAction.test.ts found).
    expect(ask.findComponent({ name: "VBtn" }).props("to")).toBe(
      "/oswiadczenia",
    );
  });

  it("says pages like it come from readers on a page the automation published", async () => {
    const ask = await mount("nauto");

    expect(ask.get("h3").text()).toBe(
      "Strony jak ta powstały dzięki czytelnikom",
    );
  });

  it("writes a large figure the Polish way", async () => {
    automatic = 12345;
    const ask = await mount("nlarge");

    expect(
      words(ask.get('[data-testid="person-reading-ask-figure"]').text()),
    ).toBe("12 345 opublikowanych osób");
  });

  it("puts the label in the count's own form", async () => {
    const label = async (count: number, node: string) => {
      automatic = count;
      clearNuxtData("person-reading-ask-figure");
      const ask = await mount(node);
      return words(ask.get('[data-testid="person-reading-ask-figure"]').text());
    };

    expect(await label(1, "none")).toBe("1 opublikowana osoba");
    expect(await label(3, "nthree")).toBe("3 opublikowane osoby");
    expect(await label(12, "ntwelve")).toBe("12 opublikowanych osób");
    expect(await label(22, "ntwentytwo")).toBe("22 opublikowane osoby");
  });

  it("leads with its words when there is no figure", async () => {
    automatic = 0;
    const ask = await mount("nzero");

    expect(ask.find('[data-testid="person-reading-ask-figure"]').exists()).toBe(
      false,
    );
    expect(ask.get('[data-testid="person-reading-ask-go"]').exists()).toBe(
      true,
    );
  });

  it("is kept out of search snippets", async () => {
    const ask = await mount("nsnippet");

    expect(
      ask.get('[data-testid="person-reading-ask"]').attributes(),
    ).toHaveProperty("data-nosnippet");
  });

  it("counts itself shown once it is in view, not on mount", async () => {
    await mount("nshown");
    expect(trackGoal).not.toHaveBeenCalled();

    reportInView?.([{ isIntersecting: false }]);
    expect(trackGoal).not.toHaveBeenCalled();

    reportInView?.([{ isIntersecting: true }]);
    expect(trackGoal).toHaveBeenCalledWith("cta:shown", { surface: "osoba" });
  });

  it("counts the click as the reading task, from a person's page", async () => {
    const ask = await mount("nclick");

    await ask.get('[data-testid="person-reading-ask-go"]').trigger("click");

    expect(trackGoal).toHaveBeenCalledWith("cta:task", {
      task: "oswiadczenia",
      from: "osoba",
    });
  });
});
