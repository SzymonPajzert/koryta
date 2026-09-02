import { beforeEach, describe, it, expect, vi } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { computed, nextTick, ref, type Ref } from "vue";
import type {
  HospitalStats,
  SupervisoryGroup,
} from "../../../server/api/stats/hospitals.get";
import {
  NO_PARTY,
  NO_REGION,
  partyDisplay,
  partySeatRows,
  breakdownRows,
  regionDisplayRows,
  regionQueueLink,
  supervisionSegments,
  useHospitalBoards,
} from "../../../app/composables/stats/useHospitalBoards";
import { partyColors } from "../../../shared/misc";

function group(overrides: Partial<SupervisoryGroup> = {}): SupervisoryGroup {
  return {
    kinds: ["rada_nadzorcza"],
    hospitals: 0,
    hospitalsWithSeats: 0,
    seats: 0,
    endedSeats: 0,
    seatsWithParty: 0,
    unreviewed: 0,
    byParty: [],
    rows: [],
    byRegion: [],
    ...overrides,
  };
}

describe("partyDisplay", () => {
  it("gives a tracked party its own colour", () => {
    expect(partyDisplay("PiS")).toEqual({
      party: "PiS",
      label: "PiS",
      color: partyColors.PiS,
      known: true,
    });
  });

  it("greys a party the site has no chip for", () => {
    // PartyChip emits no background at all for an unknown key, so the caller
    // has to decide the colour before anything is drawn.
    const display = partyDisplay("Bezpartyjni Samorządowcy");
    expect(display.known).toBe(false);
    expect(display.label).toBe("Bezpartyjni Samorządowcy");
    expect(display.color).toBeTruthy();
  });

  it("labels the no-party sentinel rather than showing it", () => {
    const display = partyDisplay(NO_PARTY);
    expect(display.known).toBe(false);
    expect(display.label).toBe("Bez partii w bazie");
    expect(display.label).not.toContain("__");
  });
});

describe("partySeatRows", () => {
  const rows = partySeatRows(
    group({
      seats: 10,
      seatsWithParty: 8,
      byParty: [
        { party: "PiS", seats: 5, people: 4, hospitals: 3 },
        { party: "PO", seats: 3, people: 3, hospitals: 2 },
        { party: NO_PARTY, seats: 2, people: 2, hospitals: 2 },
      ],
    }),
  );

  it("keeps the order the endpoint sorted in", () => {
    expect(rows.map((row) => row.party)).toEqual(["PiS", "PO", NO_PARTY]);
  });

  it("takes the share against the seats that carry a party", () => {
    // 5 of the 8 attributable seats, not 5 of 10 - a person with two parties is
    // counted under both, so the group's own total cannot be the denominator.
    expect(rows[0]?.share).toBeCloseTo(5 / 8);
    expect(rows[1]?.share).toBeCloseTo(3 / 8);
  });

  it("leaves the unattributed bucket without a share", () => {
    // A percentage next to "no party" reads as a party's result.
    expect(rows[2]?.share).toBeNull();
  });

  it("links each row to the same seats in the explore table", () => {
    // Seats held now: without `currentlyEmployed=selected` the table listed
    // everybody who ever sat on a hospital board, not the people the bar counts.
    expect(rows[0]?.to).toBe(
      "/eksploruj/tabela?party=PiS&category=szpitale&currentlyEmployed=selected",
    );
    expect(rows[2]?.to).toBe(
      "/eksploruj/tabela?party=__NONE__&category=szpitale&currentlyEmployed=selected",
    );
  });

  it("does not divide by zero when nothing carries a party", () => {
    const none = partySeatRows(
      group({
        seats: 2,
        seatsWithParty: 0,
        byParty: [{ party: NO_PARTY, seats: 2, people: 2, hospitals: 1 }],
      }),
    );
    expect(none[0]?.share).toBeNull();
  });

  it("is empty before the response arrives", () => {
    expect(partySeatRows(undefined)).toEqual([]);
  });
});

describe("supervisionSegments", () => {
  const stats: HospitalStats = {
    generatedAt: "2026-08-22T00:00:00.000Z",
    hospitals: 12,
    paid: group({ hospitals: 5 }),
    unpaid: group({ kinds: ["rada_spoleczna"], hospitals: 4 }),
    other: group({ kinds: ["brak"], hospitals: 3 }),
  };

  it("draws the exclusion instead of performing it silently", () => {
    const segments = supervisionSegments(stats);
    expect(segments.map((segment) => [segment.key, segment.value])).toEqual([
      ["paid", 5],
      ["unpaid", 4],
      ["other", 3],
    ]);
    expect(segments[1]?.label).toContain("nieuwzględnione");
  });

  it("accounts for every hospital the response counted", () => {
    const total = supervisionSegments(stats).reduce(
      (sum, segment) => sum + segment.value,
      0,
    );
    expect(total).toBe(stats.hospitals);
  });

  it("is empty before the response arrives", () => {
    expect(supervisionSegments(null)).toEqual([]);
  });
});

// A holder the tests drop a real `ref` into, rather than a plain object with a
// `value`: the composable watches the user, so the tests below that mutate it
// only mean anything if what they mutate is genuinely reactive. The ref cannot
// be made in the `vi.hoisted` factory, which runs before vue is imported.
const { userHolder, mockUseFetch, readyCallbacks } = vi.hoisted(() => ({
  userHolder: { user: null as Ref<{ uid: string } | null> | null },
  mockUseFetch: vi.fn(),
  readyCallbacks: [] as (() => void)[],
}));
vi.mock("vuefire", () => ({ useCurrentUser: () => userHolder.user }));
// `vi.stubGlobal` cannot reach these: the suite runs in the Nuxt environment,
// where `useFetch` and `onNuxtReady` are real auto-imports resolved from `#app`
// rather than globals the composable reads at call time.
mockNuxtImport("useFetch", () => mockUseFetch);
// Held rather than run, so a test can look at the page before and after
// hydration - the moment the composable is allowed to notice who is reading.
mockNuxtImport("onNuxtReady", () => (cb: () => void) => {
  readyCallbacks.push(cb);
});

describe("useHospitalBoards", () => {
  beforeEach(() => {
    readyCallbacks.length = 0;
  });

  /** The page has hydrated: `onNuxtReady` fires, and the watcher it installs
   * gets its first turn. */
  async function hydrated() {
    for (const cb of readyCallbacks.splice(0)) cb();
    await nextTick();
  }

  async function capturedQuery(user: { uid: string } | null = null) {
    userHolder.user = ref(user);
    let options: { query?: Ref<Record<string, string>> } | undefined;
    mockUseFetch.mockImplementation((_url: string, opts: typeof options) => {
      options = opts;
      return {
        data: ref(null),
        pending: ref(false),
        error: ref(null),
        refresh: vi.fn(),
      };
    });
    await useHospitalBoards();
    return computed(() => options?.query?.value);
  }

  it("asks for the plain URL when nobody is signed in", async () => {
    // The one the six-hour cache holds, ours and Cloud CDN's, and the one that
    // gets indexed. An anonymous reader has published nothing and has no reason
    // to pay for a recount.
    const query = await capturedQuery();
    expect(query.value).toEqual({});
    await hydrated();
    expect(query.value).toEqual({});
  });

  it("asks for the latest numbers once there is a signed-in reader", async () => {
    // A signed-in reader is the person who might have just published a board
    // member. `latest` is what makes the endpoint answer `no-store`, which is
    // the only instruction Cloud CDN takes - clearing the server-side cache on
    // publication never reached the copy at the edge.
    const query = await capturedQuery({ uid: "admin-uid" });
    await hydrated();
    expect(query.value).toEqual({ latest: "true" });
  });

  it("does not know the reader until the page has hydrated", async () => {
    // A returning reader's session is restored before the client's setup runs,
    // while the server never knows who is asking. Reading the user straight
    // away made the client's `useFetch` key differ from the server's, so the
    // payload went unused and the whole page hydrated against null stats -
    // ten Vue mismatch warnings and a rebuilt DOM. The reader is null on both
    // sides until hydration is over.
    const query = await capturedQuery({ uid: "admin-uid" });
    expect(query.value).toEqual({});
  });

  it("re-asks when the user resolves after the page has rendered", async () => {
    const query = await capturedQuery(null);
    await hydrated();
    expect(query.value).toEqual({});

    // A reader who signs in on the page, or whose session vuefire settles late.
    // The query is reactive precisely so `useFetch` refetches at that point
    // rather than leaving the editor on the cached copy.
    userHolder.user!.value = { uid: "admin-uid" };
    await nextTick();

    expect(query.value).toEqual({ latest: "true" });
  });
});

describe("regionQueueLink", () => {
  it("filters the table to that region's unreviewed hospital people", () => {
    const link = regionQueueLink("22")!;
    const query = new URLSearchParams(link.split("?")[1]);
    expect(link.startsWith("/eksploruj/tabela?")).toBe(true);
    expect(query.get("companyTeryt")).toBe("22");
    expect(query.get("category")).toBe("szpitale");
    expect(query.get("currentlyEmployed")).toBe("selected");
    expect(query.get("visibility")).toBe("private");
  });

  it("orders by the most recent entry, which sinks most rada społeczna seats", () => {
    // Their people carry a null `latestEmploymentStart` (1,280 of 1,723 in
    // production) and both the Firestore orderBy and the in-memory fallback put
    // nulls last under desc. It sinks them; it does not remove them.
    const query = new URLSearchParams(regionQueueLink("14")!.split("?")[1]);
    expect(query.get("sortBy")).toBe("latestEmploymentStart");
    expect(query.get("sortDesc")).toBe("true");
  });

  it("offers no link for a hospital the register places nowhere", () => {
    // companyTeryt=__NOREGION__ resolves to nothing, so the button would be a
    // dead end rather than an empty-but-honest result.
    expect(regionQueueLink(NO_REGION)).toBeNull();
    expect(regionQueueLink("")).toBeNull();
  });
});

describe("regionDisplayRows", () => {
  const row = (overrides = {}) => ({
    teryt: "14",
    name: "Województwo mazowieckie",
    hospitals: 54,
    groupHospitals: 19,
    hospitalsWithSeats: 8,
    seats: 16,
    unreviewed: 86,
    seatsWithParty: 9,
    byParty: [{ party: "PO", seats: 6, people: 6, hospitals: 5 }],
    ...overrides,
  });

  it("adds the totals and the share the chart is scaled by", () => {
    const [display] = regionDisplayRows(group({ byRegion: [row()] }));
    expect(display).toMatchObject({ seats: 16, unreviewed: 86, total: 102 });
    expect(display!.share).toBeCloseTo(16 / 102);
  });

  it("shortens the name for a row label but keeps the full one", () => {
    const [display] = regionDisplayRows(group({ byRegion: [row()] }));
    expect(display!.shortName).toBe("mazowieckie");
    expect(display!.name).toBe("Województwo mazowieckie");
  });

  it("gives a region with nothing on record a null share rather than a zero", () => {
    // 0/0 is not 0% - there is nothing to be a percentage of, and printing 0%
    // would read as "checked nothing" instead of "nothing to check".
    const [display] = regionDisplayRows(
      group({ byRegion: [row({ seats: 0, unreviewed: 0, byParty: [] })] }),
    );
    expect(display!.share).toBeNull();
  });

  it("paints the party segments and leaves the backlog a bare number", () => {
    const [display] = regionDisplayRows(group({ byRegion: [row()] }));
    expect(display!.segments).toEqual([
      {
        party: "PO",
        label: "PO",
        color: partyColors.PO,
        known: true,
        seats: 6,
      },
    ]);
    // Nothing on the row describes the 86 beyond their count.
    expect(Object.keys(display!)).not.toContain("unreviewedByParty");
    expect(JSON.stringify(display!.segments)).not.toContain("86");
  });

  it("survives a response cached from before byRegion existed", () => {
    // The endpoint holds its answer for six hours in nitro and in Cloud CDN, so
    // for six hours after this ships a reader gets the old shape.
    const stale = group();
    delete (stale as { byRegion?: unknown }).byRegion;
    expect(regionDisplayRows(stale)).toEqual([]);
    expect(regionDisplayRows(undefined)).toEqual([]);
  });

  it("reads a row that predates the unreviewed counter as zero backlog", () => {
    const [display] = regionDisplayRows(
      group({ byRegion: [{ ...row(), unreviewed: undefined }] }),
    );
    expect(display!.unreviewed).toBe(0);
    expect(display!.total).toBe(16);
  });
});

describe("breakdownRows", () => {
  const region = {
    teryt: "14",
    name: "Województwo mazowieckie",
    hospitals: 54,
    groupHospitals: 19,
    hospitalsWithSeats: 8,
    seats: 16,
    unreviewed: 86,
    seatsWithParty: 9,
    byParty: [{ party: "PO", seats: 6, people: 6, hospitals: 5 }],
  };
  const hospital = {
    id: "abc",
    name: "Szpital Miejski",
    supervisoryOrgan: "rada_nadzorcza" as const,
    legalForm: null,
    seats: 3,
    unreviewed: 7,
    parties: ["PiS"],
    byParty: [{ party: "PiS", seats: 3, people: 3, hospitals: 1 }],
  };

  it("gives a party row no backlog, because none can be attributed to it", () => {
    // The unreviewed people's parties are unapproved name matches. `null`, not
    // zero: zero would assert we had counted and found none.
    const [row] = breakdownRows(
      group({
        seats: 13,
        seatsWithParty: 13,
        byParty: [{ party: "PO", seats: 13, people: 13, hospitals: 9 }],
      }),
      "party",
    );
    expect(row!.unreviewed).toBeNull();
    expect(row!.total).toBe(13);
    expect(row!.segments).toHaveLength(1);
  });

  it("splits a województwo by party and counts the rest", () => {
    const [row] = breakdownRows(group({ byRegion: [region] }), "region");
    expect(row).toMatchObject({
      key: "14",
      label: "mazowieckie",
      seats: 16,
      unreviewed: 86,
      total: 102,
    });
    expect(row!.segments.map((s) => s.party)).toEqual(["PO"]);
  });

  it("splits a hospital the same way, and links to its own page", () => {
    const [row] = breakdownRows(group({ rows: [hospital] }), "hospital");
    expect(row).toMatchObject({
      key: "abc",
      label: "Szpital Miejski",
      seats: 3,
      unreviewed: 7,
      total: 10,
    });
    expect(row!.href).toContain("abc");
    expect(row!.to).toContain("place=abc");
    expect(row!.to).toContain("currentlyEmployed=selected");
  });

  it("keeps a hospital that has only a backlog - that is the work", () => {
    const rows = breakdownRows(
      group({
        rows: [
          { ...hospital, seats: 0, unreviewed: 4, parties: [], byParty: [] },
        ],
      }),
      "hospital",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seats).toBe(0);
  });

  it("drops a hospital with neither, which says nothing at all", () => {
    const rows = breakdownRows(
      group({
        rows: [
          { ...hospital, seats: 0, unreviewed: 0, parties: [], byParty: [] },
        ],
      }),
      "hospital",
    );
    expect(rows).toEqual([]);
  });

  it("survives a hospital row from before the backlog counter existed", () => {
    const stale = { ...hospital } as Record<string, unknown>;
    delete stale.unreviewed;
    delete stale.byParty;
    const [row] = breakdownRows(group({ rows: [stale] as never }), "hospital");
    expect(row!.unreviewed).toBe(0);
    expect(row!.segments).toEqual([]);
  });
});
