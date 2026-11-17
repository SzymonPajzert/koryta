import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import { ref } from "vue";
import PersonReadingAsk from "../../../app/components/person/ReadingAsk.vue";
import { setGlobalProp, trackGoal } from "~/composables/analytics";
import { PERSON_ASK_EXPERIMENT, assignArm } from "../../../shared/experiments";
import type { PersonDeclarations } from "../../../shared/declarations";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: ref(null) }),
}));
vi.mock("~/composables/analytics", () => ({
  trackGoal: vi.fn(),
  setGlobalProp: vi.fn(),
}));

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

/** What /api/stats/activity says the automation published in 30 days, and
 * how often it was asked. */
let automatic = 741;
let statsAsked = 0;
registerEndpoint("/api/stats/activity", () => {
  statsAsked += 1;
  return { automatic };
});

/** A session id that `osoba-skany` puts in `arm`, stored where the composable
 * looks for it: the split is live, so an unseeded session lands in either. */
function seatIn(arm: "bez" | "prosba") {
  sessionStorage.clear();
  for (let i = 0; i < 10_000; i++) {
    const id = `test-session-${i}`;
    if (assignArm(PERSON_ASK_EXPERIMENT, id) === arm) {
      sessionStorage.setItem("koryta:session", id);
      return;
    }
  }
  throw new Error(`no session id lands in ${arm}`);
}

/** happy-dom calls itself automated, and an automated browser sits every split
 * out; a reader's browser does not. */
function automated(value: boolean) {
  Object.defineProperty(navigator, "webdriver", { value, configurable: true });
}

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

/** Mounted, with the arm settled and, in the ask's arm, the figure in. */
async function mount(nodeId: string) {
  const ask = await mountSuspended(PersonReadingAsk, { props: { nodeId } });
  await flushPromises();
  await flushPromises();
  return ask;
}

const assigned = () =>
  vi
    .mocked(trackGoal)
    .mock.calls.filter(([goal]) => goal === "experiment:assigned")
    .map(([, props]) => props);

// Each test asks for its own node: the declarations are keyed by it.
describe("PersonReadingAsk", () => {
  beforeEach(() => {
    vi.mocked(trackGoal).mockClear();
    vi.mocked(setGlobalProp).mockClear();
    clearNuxtData("person-reading-ask-figure");
    automatic = 741;
    statsAsked = 0;
    reportInView = null;
    declarations({ nauto: readersPublished });
    automated(false);
    seatIn("prosba");
  });

  it("shows nothing to the half without it, and counts that half in the split", async () => {
    seatIn("bez");
    const ask = await mount("nbez");

    expect(ask.find('[data-testid="person-reading-ask"]').exists()).toBe(false);
    expect(assigned()).toEqual([{ experiment: "osoba-skany", arm: "bez" }]);
    expect(setGlobalProp).toHaveBeenCalledWith("arm:osoba-skany", "bez");
    // Nor does that half ask for the figure it will not show.
    expect(statsAsked).toBe(0);
    expect(trackGoal).not.toHaveBeenCalledWith("cta:shown", expect.anything());
  });

  it("counts the half with it in the split", async () => {
    const ask = await mount("nprosba");

    expect(ask.find('[data-testid="person-reading-ask"]').exists()).toBe(true);
    expect(assigned()).toEqual([{ experiment: "osoba-skany", arm: "prosba" }]);
    expect(setGlobalProp).toHaveBeenCalledWith("arm:osoba-skany", "prosba");
  });

  it("sits an automated browser out of the split", async () => {
    // The site's own suites and any scraper driving Chrome: the page without
    // the box, every run, and nobody counted in an arm.
    automated(true);
    try {
      const ask = await mount("nrobot");
      expect(ask.find('[data-testid="person-reading-ask"]').exists()).toBe(
        false,
      );
      expect(assigned()).toEqual([]);
      expect(setGlobalProp).not.toHaveBeenCalled();
    } finally {
      automated(false);
    }
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
    // On mount it reports the arm, and nothing about being seen.
    const shown = () =>
      vi.mocked(trackGoal).mock.calls.filter(([goal]) => goal === "cta:shown");
    expect(shown()).toEqual([]);

    reportInView?.([{ isIntersecting: false }]);
    expect(shown()).toEqual([]);

    reportInView?.([{ isIntersecting: true }]);
    expect(shown()).toEqual([["cta:shown", { surface: "osoba" }]]);
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
