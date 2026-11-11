import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import ElectionLists from "../../../app/components/region/ElectionLists.vue";
import {
  groupElectionLists,
  type RegionRun,
} from "../../../shared/electionLists";

vi.mock("~/composables/analytics", () => ({ trackGoal: vi.fn() }));
// Nobody signed in, for the banner and for whether its teaser counts as
// shown - as tests/setup.ts, plus `getCurrentUser`.
vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useFirestore: vi.fn(() => ({})),
  useCollection: vi.fn(() => ref([])),
  useFirebaseAuth: vi.fn(() => ({ currentUser: null })),
  useCurrentUser: vi.fn(() => ref(null)),
  useIsCurrentUserLoaded: vi.fn(() => ref(true)),
  getCurrentUser: async () => null,
}));

enableAutoUnmount(afterEach);

/** A run as the endpoint answers it, with what a test does not care about
 * filled in. */
function run(over: Partial<RegionRun> & { personId: string }): RegionRun {
  return {
    edgeId: `${over.personId}-${over.start ?? "2024"}`,
    personName: over.personId,
    parties: [],
    published: true,
    start: "2024-01-01",
    position: "Rada powiatu",
    committee: "KWW Nasz Powiat",
    party: null,
    elected: false,
    byElection: false,
    ...over,
  };
}

function mountLists(runs: RegionRun[]) {
  return mountSuspended(ElectionLists, {
    props: { regionId: "teryt1005", groups: groupElectionLists(runs) },
    attachTo: document.body,
  });
}

describe("RegionElectionLists", () => {
  it("opens an election's other lists in place and hands focus to the first one", async () => {
    // Eight committees in one election: six show, and since the button
    // would take the room of one row, the fold holds the last two.
    const view = await mountLists(
      Array.from({ length: 8 }, (_, index) =>
        run({
          personId: `Osoba ${index}`,
          committee: `KWW Komitet ${String.fromCharCode(65 + index)}`,
        }),
      ),
    );
    const heads = () => view.findAll(".list-row__head");
    expect(heads()).toHaveLength(6);

    const button = view.get('[data-testid="election-lists-more-local-2024"]');
    expect(button.attributes("aria-expanded")).toBe("false");
    const box = document.getElementById(button.attributes("aria-controls")!);
    expect(box?.classList.contains("lists-box")).toBe(true);

    await button.trigger("click");
    await flushPromises();

    expect(heads()).toHaveLength(8);
    expect(
      view.find('[data-testid="election-lists-more-local-2024"]').exists(),
    ).toBe(false);
    // Where the button was, so a keyboard is not dropped back to the top.
    expect(document.activeElement).toBe(heads()[6]!.element);
  });

  it("sends a reader back from logging in to the page, not to its hash", async () => {
    // Opened from a gmina's pointer in a new tab: the server renders the page
    // without the hash, the browser hydrates it with one.
    const view = await mountSuspended(ElectionLists, {
      props: {
        regionId: "teryt1005",
        groups: groupElectionLists([
          run({
            personId: "Bogdan Szkic",
            published: false,
            partyHidden: true,
          }),
        ]),
      },
      route: "/region/powiat-x-teryt1005#listy-wyborcze",
    });
    const buttons = view
      .get('[data-testid="election-lists-party-teaser"]')
      .findAllComponents({ name: "VBtn" });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.props("to")).toMatchObject({
        path: "/login",
        query: { redirect: "/region/powiat-x-teryt1005" },
      });
    }
  });

  it("opens the older elections in place and hands focus to the first one's head", async () => {
    const years = ["2024", "2018", "2014", "2010", "2006"];
    const view = await mountLists(
      years.map((year) =>
        run({ personId: `Osoba ${year}`, start: `${year}-01-01` }),
      ),
    );
    const groups = () => view.findAll('[data-testid^="election-group-"]');
    expect(groups()).toHaveLength(4);

    const button = view.get('[data-testid="election-lists-older"]');
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(
      document.getElementById(button.attributes("aria-controls")!),
    ).not.toBeNull();

    await button.trigger("click");
    await flushPromises();

    expect(groups()).toHaveLength(5);
    expect(view.find('[data-testid="election-lists-older"]').exists()).toBe(
      false,
    );
    const head = groups()[4]!.get("h3");
    expect(head.text()).toContain("2006");
    expect(document.activeElement).toBe(head.element);
  });
});
