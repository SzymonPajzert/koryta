import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { clearNuxtData } from "#app";
import CompanyChanges from "../../../app/components/succession/CompanyChanges.vue";
import { trackGoal } from "~/composables/analytics";
import { noteSearchPick } from "~/composables/teaserJourney";
import type {
  CompanySuccessions,
  CurrentPost,
  Succession,
  SuccessionSide,
} from "../../../server/api/edges/successions.get";

/** Who is signed in, if anybody: `useCurrentUser` for the query and the
 * banner, `getCurrentUser` for whether the teaser counts as shown. */
const auth = vi.hoisted(() => ({
  user: null as { uid: string; getIdToken: () => Promise<string> } | null,
}));

// `ref` is only called once a component asks for the user, by which time the
// import above has long resolved - as in tests/setup.ts.
vi.mock("vuefire", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import("vuefire")>()),
    useFirestore: vi.fn(() => ({})),
    useCollection: vi.fn(() => ref([])),
    useFirebaseAuth: vi.fn(() => ({ currentUser: null })),
    useCurrentUser: vi.fn(() => ref(auth.user)),
    useIsCurrentUserLoaded: vi.fn(() => ref(true)),
    getCurrentUser: async () => auth.user,
  };
});
vi.mock("~/composables/analytics", () => ({ trackGoal: vi.fn() }));

/** What the endpoint will answer with, set by each test before it mounts. */
let response: CompanySuccessions = { successions: [], current: [], hidden: 0 };

registerEndpoint("/api/edges/successions", () => response);

function side(
  name: string,
  extra: Partial<SuccessionSide> = {},
): SuccessionSide {
  return {
    edgeId: `e-${name}`,
    personId: `p-${name}`,
    personName: name,
    parties: [],
    start: null,
    end: null,
    published: true,
    ...extra,
  };
}

function succession(
  left: SuccessionSide,
  joined: SuccessionSide,
  extra: Partial<Succession> = {},
): Succession {
  return {
    companyId: "tauron",
    companyName: "Tauron",
    role: "Zarząd",
    date: joined.start,
    gapDays: 0,
    left,
    joined,
    ...extra,
  };
}

function post(name: string, extra: Partial<CurrentPost> = {}): CurrentPost {
  return {
    edgeId: `e-${name}`,
    personId: `p-${name}`,
    personName: name,
    parties: [],
    role: "Zarząd",
    start: "2024-04-12",
    published: true,
    ...extra,
  };
}

/** A board of `names` all struck off and replaced on `date`, which is the
 * shape the register files a turnover in. */
function turnover(date: string, names: [string, string][], role = "Zarząd") {
  return names.map(([out, into]) =>
    succession(
      side(out, { start: "2016-02-16", end: date }),
      side(into, { start: date, end: null }),
      { role, date },
    ),
  );
}

/** Mounts and waits for the fetch to land.
 *
 * The component does not await its own `authFetch` - Nuxt settles it before
 * serialising a server rendered page, and awaiting would hold a client-side
 * navigation on this one section - so `mountSuspended` returns while the
 * spinner is still on screen.
 */
async function mountChanges(companyId = "tauron") {
  const wrapper = await mountSuspended(CompanyChanges, {
    props: { companyId, companyName: "Tauron Dystrybucja" },
  });
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="successions-relay"]').exists() ||
      wrapper.find('[data-testid="successions-empty"]').exists(),
    { timeout: 5000 },
  );
  return wrapper;
}

describe("SuccessionCompanyChanges", () => {
  beforeEach(() => {
    response = { successions: [], current: [], hidden: 0 };
    // One Nuxt app serves the whole file, so the previous test's answer is
    // still in the payload and the next mount would re-serve it without
    // asking for anything.
    clearNuxtData();
  });

  it("draws a board that turned over on one day as one card", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Radosław Pobol", "Barbara Hanczarek"],
        ["Jakub Dziedzic", "Leszek Kosiorek"],
        ["Tomasz Jachna", "Marcin Marzyński"],
      ]),
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    // One decision in the register, so one card - not three.
    expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="succession-row"]')).toHaveLength(3);
    expect(wrapper.get('[data-testid="batch-count"]').text()).toBe(
      "3 zmiany tego samego dnia",
    );
    // Polish, not the ISO day the endpoint sent.
    expect(wrapper.text()).toContain("12 kwietnia 2024");
    expect(wrapper.text()).not.toContain("2024-04-12");
  });

  it("keeps handovers on different days in separate cards", async () => {
    response = {
      successions: [
        ...turnover("2024-04-12", [["Tomasz Jachna", "Marcin Marzyński"]]),
        ...turnover("2023-06-30", [["Waldemar Skomudek", "Maciej Mróz"]]),
      ],
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(2);
    // A single handover is not a batch, so it carries no "N zmian" badge.
    expect(wrapper.findAll('[data-testid="batch-count"]')).toHaveLength(0);
    expect(wrapper.text()).toContain("30 czerwca 2023");
  });

  it("tallies the parties of the people leaving on one day", async () => {
    const [first, second] = turnover("2024-04-12", [
      ["Tomasz Jachna", "Marcin Marzyński"],
      ["Jakub Dziedzic", "Leszek Kosiorek"],
    ]);
    first!.left.parties = ["PiS"];
    second!.left.parties = ["PiS"];

    response = { successions: [first!, second!], current: [], hidden: 0 };

    const wrapper = await mountChanges();

    expect(wrapper.get('[data-testid="batch-parties"]').text()).toContain(
      "wśród ustępujących: 2 × PiS",
    );
  });

  it("splits the relay by role, Zarząd before Rada Nadzorcza", async () => {
    response = {
      successions: [
        ...turnover(
          "2024-05-13",
          [["Wojciech Lutek", "Grzegorz Kuca"]],
          "Rada Nadzorcza",
        ),
        ...turnover("2024-04-12", [["Tomasz Jachna", "Marcin Marzyński"]]),
      ],
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    const roles = wrapper
      .findAll('[data-testid^="succession-role-"]')
      .map((node) => node.attributes("data-testid"));
    expect(roles).toEqual([
      "succession-role-zarzad",
      "succession-role-rada-nadzorcza",
    ]);
    // Each role batches on its own: two dates, two cards, one row each.
    expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(2);
  });

  // „Kolejność osób - prezes, zastępca prezesa, potem zarząd.” PKP's current
  // board came out as Zarząd, dyrektor…, naczelnik…, prezes, zastępca prezesa:
  // the order knew Zarząd and the supervisory boards and put every other role
  // after them alphabetically, the head of the company among them.
  it("puts the prezes first and the deputies second, then the board", async () => {
    response = {
      successions: [],
      current: [
        post("A", { role: "Zarząd" }),
        post("B", { role: "dyrektor Biura Zarządzania Strategicznego" }),
        post("C", { role: "naczelnik w Biurze Spraw Międzynarodowych" }),
        post("D", { role: "prezes" }),
        post("E", { role: "zastępca prezesa" }),
        post("F", { role: "Rada Nadzorcza" }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    const roles = wrapper
      .findAll('[data-testid^="current-role-"]')
      .map((node) => node.attributes("data-testid"));
    expect(roles).toEqual([
      "current-role-prezes",
      "current-role-zastepca-prezesa",
      "current-role-zarzad",
      "current-role-rada-nadzorcza",
      "current-role-dyrektor-biura-zarzadzania-strategicznego",
      "current-role-naczelnik-w-biurze-spraw-miedzynarodowych",
    ]);
  });

  it("ranks the register's longer titles the same way", async () => {
    response = {
      successions: [],
      current: [
        post("A", { role: "Członek Zarządu" }),
        post("B", { role: "Wiceprezes Zarządu" }),
        post("C", { role: "Prokurent" }),
        post("D", { role: "Prezes Zarządu" }),
        post("E", { role: "Zastępca Prezesa Zarządu" }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    const roles = wrapper
      .findAll('[data-testid^="current-role-"]')
      .map((node) => node.attributes("data-testid"));
    expect(roles).toEqual([
      "current-role-prezes-zarzadu",
      "current-role-wiceprezes-zarzadu",
      "current-role-zastepca-prezesa-zarzadu",
      "current-role-czlonek-zarzadu",
      "current-role-prokurent",
    ]);
  });

  it("says how many handovers it will not name", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Tomasz Jachna", "Marcin Marzyński"],
      ]),
      current: [],
      hidden: 4,
    };

    const wrapper = await mountChanges();

    const note = wrapper.get('[data-testid="successions-hidden"]').text();
    expect(note).toContain("4 zmian");
    expect(note).toContain("brakuje strony");
  });

  it("names the current board and how long it has sat", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Krzysztof Durkalec", "Marcin Marzyński"],
      ]),
      current: [post("Marcin Marzyński")],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    const composition = wrapper.get('[data-testid="successions-current"]');
    expect(composition.text()).toContain("Marcin Marzyński");
    expect(composition.text()).toContain("od 12 kwietnia 2024");
    // The card names whoever the handover put out of that same seat.
    expect(composition.text()).toContain("wcześniej na tym stanowisku");
    expect(composition.text()).toContain("Krzysztof Durkalec");
  });

  it("says nobody holds an open post rather than heading an empty grid", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Tomasz Jachna", "Marcin Marzyński"],
      ]),
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(wrapper.find('[data-testid="current-empty"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid^="current-role-"]')).toHaveLength(0);
  });

  it("prints what is missing instead of a null date", async () => {
    response = {
      successions: [
        succession(
          side("Jerzy Rzemyszkiewicz", { start: null, end: "2018-01-17" }),
          side("Krzysztof Durkalec", { start: "2018-01-16", end: null }),
          { date: "2018-01-16", gapDays: -1 },
        ),
      ],
      current: [post("Anna Bez Daty", { start: null })],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(wrapper.text()).not.toContain("null");
    expect(wrapper.text()).toContain("brak daty rozpoczęcia");
    expect(wrapper.text()).toContain("bez daty powołania");
    // `gapLabel` from shared/succession, so the two filings disagreeing reads
    // as a sentence rather than as a negative number of days.
    expect(wrapper.text()).toContain("wpisy nachodzą na siebie o 1 dzień");
  });

  it("says the whole section is empty rather than heading nothing", async () => {
    response = { successions: [], current: [], hidden: 0 };

    const wrapper = await mountChanges("pusta");

    expect(wrapper.find('[data-testid="successions-empty"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain("Obecny skład");
    expect(wrapper.text()).not.toContain("Kto kogo zastąpił");
    expect(wrapper.text()).toContain("Tauron Dystrybucja");
  });
});

describe("SuccessionCompanyChanges, unpublished holders", () => {
  beforeEach(() => {
    auth.user = null;
    vi.mocked(trackGoal).mockClear();
    response = {
      successions: [],
      current: [
        post("Anna Nowak", { parties: ["PO"] }),
        post("Jan Kowalski", { published: false, partyHidden: true }),
        post("Ewa Zielińska", { published: false }),
      ],
      hidden: 0,
    };
    clearNuxtData();
  });

  it("stands a chip in for the party it is not told, and says what it is", async () => {
    const wrapper = await mountChanges();

    const chips = wrapper.findAll('[data-testid="hidden-party"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toBe("???");
    // Says what it stands for, and leads nowhere (Szymon, 2026-10-24).
    expect(chips[0]!.attributes("aria-label")).toBe(
      "Informacja o partii nie jest jeszcze zweryfikowana. Widoczna tylko dla zalogowanych.",
    );
    expect(chips[0]!.element.closest("a")).toBeNull();
    // On the card of the holder whose party is held back, and only there.
    const card = chips[0]!.element.closest(".k-card");
    expect(card?.textContent).toContain("Jan Kowalski");
    expect(card?.textContent).not.toContain("Ewa Zielińska");
    // A published holder keeps the party chip they always had.
    expect(wrapper.text()).toContain("PO");
  });

  it("leads the banner to the sign in, back to this page", async () => {
    const wrapper = await mountChanges();

    const banner = wrapper.get('[data-testid="current-party-teaser"]');
    // „przy 1 osobie”: the locative, whatever the count.
    expect(banner.text()).toContain("Przy 1 osobie z obecnego składu");
    expect(
      banner
        .findAllComponents({ name: "VBtn" })
        .find((b) => b.attributes("data-testid") === "login-banner-signup")
        ?.props("to"),
    ).toEqual({
      path: "/login",
      query: {
        redirect: expect.any(String),
        powod: "partie-w-skladzie",
        konto: "nowe",
      },
    });
  });

  it("counts the holders in the banner by the locative", async () => {
    response = {
      ...response,
      current: [
        post("Jan Kowalski", { published: false, partyHidden: true }),
        post("Adam Lis", { published: false, partyHidden: true }),
      ],
    };
    const wrapper = await mountChanges();

    expect(
      wrapper.get('[data-testid="current-party-teaser"]').text(),
    ).toContain("Przy 2 osobach z obecnego składu");
  });

  it("tells a crawler not to follow a name to a page nobody published", async () => {
    const wrapper = await mountChanges();

    const rel = (name: string) =>
      wrapper
        .findAll("a")
        .find((a) => a.text() === name)
        ?.attributes("rel");
    expect(rel("Jan Kowalski")).toBe("nofollow");
    expect(rel("Ewa Zielińska")).toBe("nofollow");
    expect(rel("Anna Nowak")).toBeUndefined();
  });

  it("offers no banner where no party is held back", async () => {
    response = {
      ...response,
      current: [post("Ewa Zielińska", { published: false })],
    };
    const wrapper = await mountChanges();

    expect(wrapper.find('[data-testid="hidden-party"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="current-party-teaser"]').exists()).toBe(
      false,
    );
  });

  it("offers a signed in reader no banner", async () => {
    // The server renders anonymously, so a signed in reader is handed the
    // locks for the moment before their own answer arrives.
    auth.user = { uid: "reader", getIdToken: async () => "token" };
    const wrapper = await mountChanges();
    await flushPromises();

    expect(wrapper.find('[data-testid="current-party-teaser"]').exists()).toBe(
      false,
    );
    expect(trackGoal).not.toHaveBeenCalledWith(
      "teaser:shown",
      expect.anything(),
    );
  });

  it("counts being shown, and whether the search box sent the reader", async () => {
    noteSearchPick("tauron");
    await mountChanges();
    await flushPromises();

    expect(trackGoal).toHaveBeenCalledWith("teaser:shown", {
      surface: "instytucja",
      kind: "partia",
      from: "search",
    });
    expect(
      vi
        .mocked(trackGoal)
        .mock.calls.filter(([goal]) => goal === "teaser:shown"),
    ).toHaveLength(1);
  });

  it("counts which way in was clicked", async () => {
    const wrapper = await mountChanges();

    await wrapper.get('[data-testid="login-banner-signup"]').trigger("click");
    await wrapper.get('[data-testid="login-banner-login"]').trigger("click");

    expect(trackGoal).toHaveBeenCalledWith("teaser:click", {
      surface: "instytucja",
      kind: "partia",
      mode: "signup",
    });
    expect(trackGoal).toHaveBeenCalledWith("teaser:click", {
      surface: "instytucja",
      kind: "partia",
      mode: "login",
    });
  });
});
