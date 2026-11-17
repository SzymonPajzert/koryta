import { describe, it, expect } from "vitest";
import {
  arrivedSince,
  bandOf,
  candidacyOf,
  countPeople,
  cropRecordOf,
  differentKind,
  factsByPage,
  indexCrops,
  MIN_SETTLED,
  namedElsewhere,
  namesakeEstimate,
  pagesTouched,
  peopleSnapshot,
  personEntrySchema,
  roundHalfEven,
  searchReason,
  stageOf,
  type CropRecord,
  type PageCrop,
  type PageNode,
  type PublicationState,
} from "../../shared/declarationPeople";
import {
  declarationPeopleSchema,
  peopleGroups,
  peopleStages,
  type DeclarationFact,
  type DeclarationPeople,
  type PageOutcome,
  type PeopleStage,
  type PublicationStatus,
} from "../../shared/declarations";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../scripts/declarationPeople";

/** A night's count, small: every stage present once over. */
const snapshot = (over: Partial<DeclarationPeople> = {}) => ({
  at: "2026-11-14T06:30:00.000Z",
  exportDay: "2026-11-14",
  people: 36,
  published: 8,
  namesakes: 1,
  mismatched: 2,
  held: 3,
  reading: 4,
  cropped: 5,
  downloaded: 6,
  searching: 7,
  searchingBy: [{ reason: "unreachable", count: 7 }],
  expectedNamesakes: { count: 3, low: 2, high: 4 },
  bySurname: [{ min: 0, max: 50, settled: 9, namesakes: 1, remaining: 20 }],
  topUnits: [
    {
      teryt: "106101",
      name: "Przykładowo (gmina miejska)",
      people: 7,
      reason: "unreachable",
    },
  ],
  publishedByDay: [{ day: "2026-11-13", count: 8 }],
  ...over,
});

describe("declarationPeopleSchema", () => {
  it("reads a night's count", () => {
    expect(declarationPeopleSchema.safeParse(snapshot()).success).toBe(true);
  });

  it("refuses stages that do not add up to the people counted", () => {
    // Every person is in exactly one stage: a count that loses somebody, or
    // counts them twice, would draw a line that lies.
    const result = declarationPeopleSchema.safeParse(snapshot({ people: 37 }));
    expect(result.success).toBe(false);
  });

  it("refuses a reason the site has no words for", () => {
    const result = declarationPeopleSchema.safeParse(
      snapshot({
        searchingBy: [{ reason: "gone" as "unreachable", count: 7 }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("takes no estimate before enough have settled", () => {
    expect(
      declarationPeopleSchema.safeParse(snapshot({ expectedNamesakes: null }))
        .success,
    ).toBe(true);
  });

  it("reads the snapshot the emulator is seeded with", () => {
    // The seed is what every local stack and test run draws from: a shape the
    // site refuses would leave the panel and the page empty there.
    expect(declarationPeopleSchema.safeParse(seeded).success).toBe(true);
  });
});

describe("peopleGroups", () => {
  it("counts the namesakes apart, outside the total", () => {
    const groups = peopleGroups(snapshot() as DeclarationPeople);
    expect(groups.total).toBe(35);
    expect(groups.namesakes).toBe(1);
    expect(groups.published + groups.underway + groups.searching).toBe(
      groups.total,
    );
  });

  it("puts everything with a declaration in hand and no publication under way", () => {
    // Held, mismatched, with readers, cropped and downloaded: 2+3+4+5+6.
    expect(peopleGroups(snapshot() as DeclarationPeople).underway).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// The count: shared/declarationPeople.ts
// ---------------------------------------------------------------------------

const AT = new Date("2026-11-17T06:15:00.000Z");

function fact(
  key: string,
  page: string,
  over: Partial<DeclarationFact> = {},
): DeclarationFact {
  return {
    key,
    kids: [page],
    teryt: "021704",
    unitName: "Testowo (gmina wiejska)",
    year: 2024,
    status: "found",
    reason: "named",
    uncut: false,
    cutNamed: false,
    waiting: false,
    // Jan Kowalski.
    bearers: 30_000,
    ...over,
  };
}

/** The night's list: one candidacy a page, and what predator knows of it. */
const FACTS = [
  fact("k-published", "published"),
  fact("k-queued", "queued"),
  fact("k-held", "held"),
  fact("k-namesake", "namesake"),
  fact("k-misread", "misread"),
  fact("k-reading", "reading"),
  // A page merged into "reading": the same person, counted once.
  fact("k-merged", "merged-away"),
  fact("k-cropped", "cropped", { cutNamed: true, waiting: true }),
  // Cut and on the site, but the crop names another page.
  fact("k-sent", "sent", { cutNamed: true }),
  fact("k-not-cut", "not-cut", { uncut: true }),
  // Cut, and no date line found on it.
  fact("k-no-label", "no-label", { cutNamed: true }),
  fact("k-blocked", "blocked", {
    status: "not_found",
    reason: "unreachable",
    teryt: "106101",
    unitName: "Łódź (gmina miejska)",
  }),
  // Only a council's file came down for him, and no page of it is his.
  fact("k-council", "council", { status: "unconfirmed", reason: "unnamed" }),
  // Her name is on a page of the council's file: a crop of hers waits.
  fact("k-on-council", "on-council", { waiting: true, bearers: 6_000 }),
  fact("k-no-post", "no-post"),
  fact("k-public", "public"),
];

const crop = (
  personIds: string[],
  {
    outcomes = {},
    ...over
  }: Partial<Omit<CropRecord, "pageOutcomes">> & {
    outcomes?: Record<string, PageOutcome>;
  } = {},
): CropRecord => ({
  status: "agreed",
  personIds,
  pageOutcomes: new Map(Object.entries(outcomes)),
  value: "1970-05-05",
  candidacyKeys: [],
  createdAt: null,
  ...over,
});

/** When predator wrote the night's facts. */
const FACTS_AT = Date.parse("2026-11-17T05:15:00.000Z");

/** What the site holds of those pages. */
function site() {
  const pages = [
    "published",
    "queued",
    "held",
    "namesake",
    "misread",
    "reading",
    "cropped",
    "sent",
    "not-cut",
    "no-label",
    "blocked",
    "council",
    "on-council",
    "no-post",
    "public",
  ];
  const nodes = new Map<string, PageNode>(
    pages.map((page) => [
      page,
      {
        type: "person",
        published: page === "published" || page === "public",
        birthDate: "1970-05-05",
      },
    ]),
  );
  const resolve = (page: string) => (page === "merged-away" ? "reading" : page);
  const crops = indexCrops(
    [
      crop(["published"], { outcomes: { published: "queued" } }),
      crop(["queued"], { outcomes: { queued: "queued" } }),
      crop(["held"], { outcomes: { held: "held" } }),
      crop(["namesake"], {
        outcomes: { namesake: "different" },
        value: "1973-02-11",
      }),
      crop(["misread"], {
        outcomes: { misread: "different" },
        value: "1970-05-08",
      }),
      crop(["reading"], { status: "open", value: null }),
      crop(["somebody-else"], {
        status: "open",
        value: null,
        candidacyKeys: ["k-sent"],
      }),
    ],
    resolve,
  );
  return {
    byPage: factsByPage(FACTS, resolve),
    nodes,
    publicPosts: new Set(pages.filter((page) => page !== "no-post")),
    publications: new Map<string, PublicationState>([
      [
        "published",
        { status: "published", reason: null, publishedOn: "2026-11-16" },
      ],
      ["queued", { status: "queued", reason: null, publishedOn: null }],
      ["held", { status: "held", reason: "two_places", publishedOn: null }],
    ]),
    crops,
    factsAt: FACTS_AT,
    now: AT,
  };
}

describe("countPeople", () => {
  it("puts every person in one stage, and the stages add up", () => {
    const counted = countPeople(site());

    expect(
      Object.fromEntries(
        [...counted.entries].map(([page, e]) => [page, [e.stage, e.detail]]),
      ),
    ).toEqual({
      published: ["published", ""],
      queued: ["held", "queued"],
      held: ["held", "held:two_places"],
      namesake: ["namesakes", ""],
      misread: ["mismatched", ""],
      reading: ["reading", ""],
      cropped: ["cropped", ""],
      "on-council": ["cropped", ""],
      // On the site already, but no crop of the site's is his.
      sent: ["searching", "other_page"],
      "not-cut": ["downloaded", ""],
      "no-label": ["searching", "no_date_line"],
      blocked: ["searching", "unreachable"],
      council: ["searching", "not_listed"],
    });
    expect(counted.leftOut).toEqual({
      gone: 0,
      noPublicPost: 1,
      publicOtherwise: 1,
    });
    expect(counted.entries.get("reading")?.keys).toEqual([
      "k-merged",
      "k-reading",
    ]);
    const snapshot = peopleSnapshot(counted.entries, AT);
    expect(peopleStages.reduce((sum, stage) => sum + snapshot[stage], 0)).toBe(
      13,
    );
    expect(snapshot.people).toBe(13);
  });

  it("draws the site's snapshot", () => {
    const snapshot = peopleSnapshot(countPeople(site()).entries, AT);

    expect(declarationPeopleSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.at).toBe("2026-11-17T06:15:00.000Z");
    expect(snapshot.exportDay).toBe("2026-11-17");
    expect(snapshot.searchingBy).toEqual([
      { reason: "unreachable", count: 1 },
      { reason: "not_listed", count: 1 },
      { reason: "no_date_line", count: 1 },
      { reason: "other_page", count: 1 },
    ]);
    expect(snapshot.topUnits).toEqual([
      {
        teryt: "106101",
        name: "Łódź (gmina miejska)",
        people: 1,
        reason: "unreachable",
      },
    ]);
    expect(snapshot.publishedByDay).toEqual([{ day: "2026-11-16", count: 1 }]);
    expect(snapshot.bySurname.map((band) => band.max)).toEqual([
      50,
      1_000,
      5_000,
      20_000,
      null,
    ]);
    // Five settled is too few to say anything about the rest.
    expect(snapshot.expectedNamesakes).toBeNull();
  });

  it("leaves out a page that is gone, and reports reasons it has no word for", () => {
    const world = site();
    const counted = countPeople({
      ...world,
      byPage: factsByPage(
        [
          ...FACTS,
          fact("k-gone", "gone"),
          fact("k-captcha", "blocked", {
            status: "not_found",
            reason: "captcha",
          }),
        ],
        (page) => (page === "merged-away" ? "reading" : page),
      ),
    });

    expect(counted.leftOut.gone).toBe(1);
    // The BIP's own reason still names his; the unknown one is reported.
    expect(counted.entries.get("blocked")?.detail).toBe("unreachable");
    expect(counted.unknownReasons).toEqual({ captcha: 1 });
  });
});

describe("stageOf", () => {
  const page = (crops: PageCrop[], status: PublicationStatus | null) => ({
    publication: status ? { status, reason: null, publishedOn: null } : null,
    crops,
    birthDate: "1970-05-05",
    elsewhere: false,
    arrived: new Set<string>(),
    candidacies: [candidacyOf(fact("k", "p"))],
    thisYear: 2026,
  });

  it("reads a crop on the site waiting for its comparison as still being read", () => {
    expect(
      stageOf(
        page(
          [{ status: "agreed", outcome: null, value: "1970-05-05" }],
          "queued",
        ),
      ),
    ).toEqual({ stage: "reading", detail: "" });
  });

  it("makes a namesake of one namesake's date, whatever else was read", () => {
    expect(
      stageOf(
        page(
          [
            { status: "agreed", outcome: "different", value: "1984-02-11" },
            { status: "agreed", outcome: "different", value: "1973-02-11" },
          ],
          null,
        ),
      ),
    ).toEqual({ stage: "namesakes", detail: "" });
  });

  it("holds a page whose match nothing recorded, and one with no date to compare", () => {
    expect(
      stageOf(
        page([{ status: "agreed", outcome: "queued", value: "x" }], null),
      ),
    ).toEqual({ stage: "held", detail: "unrecorded" });
    expect(
      stageOf(
        page([{ status: "agreed", outcome: "no_date", value: "1970" }], null),
      ),
    ).toEqual({ stage: "held", detail: "no_date" });
  });

  it("takes a crop that reached the site after predator's facts for the one they said waits", () => {
    const open: PageCrop = { status: "open", outcome: null, value: null };
    const unreadable: PageCrop = { ...open, status: "unreadable" };
    const waits = {
      ...page([], null),
      candidacies: [candidacyOf(fact("k", "p", { waiting: true }))],
    };
    const notCut = {
      ...page([], null),
      candidacies: [candidacyOf(fact("k", "p", { uncut: true }))],
    };
    const arrived = new Set(["k"]);

    expect(stageOf({ ...waits, crops: [open] }).stage).toBe("reading");
    // Settled unreadable: the facts still say a crop of theirs waits.
    expect(stageOf({ ...waits, crops: [unreadable] }).stage).toBe("cropped");
    expect(stageOf({ ...notCut, crops: [unreadable] }).stage).toBe(
      "downloaded",
    );
    // Unless it reached the site after them: it is the one they meant.
    for (const person of [waits, notCut]) {
      expect(stageOf({ ...person, crops: [unreadable], arrived })).toEqual({
        stage: "searching",
        detail: "unreadable",
      });
    }
  });

  it("takes nothing from what a crop said of its pages before it was taken back, found unreadable or settled on a year", () => {
    const said = (status: string, value: string | null, outcome: string) =>
      cropRecordOf({
        status,
        agreed: value ? { value } : null,
        personIds: ["p"],
        pageOutcomes: { p: outcome },
      });
    const stale = [
      said("withdrawn", null, "no_date"),
      said("unreadable", null, "queued"),
      said("agreed", "1970", "different"),
    ];
    const stageOfCrop = (crop: CropRecord) =>
      stageOf(page(indexCrops([crop], (id) => id).byPage.get("p")!, null));

    expect(stale.map((crop) => crop.pageOutcomes.get("p"))).toEqual([
      null,
      null,
      null,
    ]);
    expect(stale.map(stageOfCrop)).toEqual([
      { stage: "searching", detail: "other_page" },
      { stage: "searching", detail: "unreadable" },
      // A year alone is compared with no page.
      { stage: "reading", detail: "" },
    ]);
    expect(stageOfCrop(said("agreed", "1984-02-11", "different"))).toEqual({
      stage: "mismatched",
      detail: "",
    });
  });
});

describe("differentKind", () => {
  it.each([
    ["1973-02-11", "1970-05-05", "namesake"], // three years off
    ["1970-11-23", "1970-05-05", "namesake"], // same year, far apart
    ["1970-05-08", "1970-05-05", "mismatched"], // a slip of a digit
    ["1971-05-05", "1970-05-05", "mismatched"], // the year misread
    ["1984-02-11", "1970-05-05", "mismatched"], // ten years and more: a file
    ["2025-03-01", "1970-05-05", "mismatched"], // the day it was signed
    ["1972", "1970-05-05", "namesake"], // a year alone
    ["1972-01-01", "", "mismatched"], // nothing to tell it by
  ] as const)("reads %s against %s as %s", (read, pageDate, kind) => {
    expect(differentKind(read, pageDate, 2026)).toBe(kind);
  });
});

describe("searchReason", () => {
  const row = (key: string, over: Partial<DeclarationFact>) =>
    candidacyOf(fact(key, "p", over));

  it("says the BIP not answering before a search that found nothing", () => {
    const rows = [
      row("b", { status: "not_found", reason: "not_listed" }),
      row("a", { status: "unconfirmed", reason: "unnamed" }),
      row("c", { status: "not_found", reason: "robots", teryt: "020100" }),
    ];

    const { reason, from } = searchReason(rows);

    expect([reason, from.teryt]).toEqual(["robots", "020100"]);
    expect(searchReason(rows.slice(0, 2)).reason).toBe("not_listed");
    expect(searchReason([row("d", { status: "pending" })]).reason).toBe(
      "pending",
    );
  });

  it("counts a reason it has no word for as nothing tried, and says so", () => {
    const newest = row("e", { status: "pending", year: 2024 });
    const result = searchReason([
      row("d", { status: "not_found", reason: "captcha", year: 2018 }),
      newest,
    ]);

    expect(result).toEqual({
      reason: "pending",
      from: newest,
      unknown: ["captcha"],
    });
  });
});

describe("namesakeEstimate", () => {
  const settled = (n: number, band: number, namesakes = 0) =>
    Array.from({ length: n }, (_, i) => ({
      page: `s${band}-${String(i).padStart(2, "0")}`,
      stage: (i < namesakes ? "namesakes" : "published") as PeopleStage,
      band,
    }));
  const waiting = (n: number, band: number) =>
    Array.from({ length: n }, (_, i) => ({
      page: `w${band}-${i}`,
      stage: "searching" as PeopleStage,
      band,
    }));

  it("follows how common a surname is", () => {
    const crowd = [
      ...settled(MIN_SETTLED, 0),
      ...waiting(5, 0),
      ...settled(MIN_SETTLED, 4, MIN_SETTLED / 2),
      ...waiting(4, 4),
    ];

    const { bySurname, expectedNamesakes } = namesakeEstimate(crowd);

    expect(bySurname[0]).toEqual({
      min: 0,
      max: 50,
      settled: MIN_SETTLED,
      namesakes: 0,
      remaining: 5,
    });
    expect(bySurname.at(-1)?.namesakes).toBe(MIN_SETTLED / 2);
    // None among the rare surnames, half of the four with a common one.
    expect(expectedNamesakes?.count).toBe(2);
    expect(expectedNamesakes!.low).toBeLessThanOrEqual(2);
    expect(expectedNamesakes!.high).toBeGreaterThanOrEqual(2);
    // Seeded: the same people, the same interval, in any order.
    expect(namesakeEstimate([...crowd].reverse())).toEqual({
      bySurname,
      expectedNamesakes,
    });
  });

  it("matches the night's point estimate, rounded half to even", () => {
    // 7 namesakes of 23 with 9 waiting is 2.74, and 1 of 20 with 10
    // waiting 0.5: 3.24, so 3. The 0.5 alone rounds to 0, as in Python.
    const crowd = [
      ...settled(23, 2, 7),
      ...waiting(9, 2),
      ...settled(20, 3, 1),
      ...waiting(10, 3),
    ];
    expect(namesakeEstimate(crowd).expectedNamesakes?.count).toBe(3);
    expect(
      namesakeEstimate([...settled(20, 3, 1), ...waiting(10, 3)])
        .expectedNamesakes?.count,
    ).toBe(0);
    expect([0.5, 1.5, 2.5, 2.4999, 2.5001].map(roundHalfEven)).toEqual([
      0, 2, 2, 2, 3,
    ]);
  });

  it("says nothing for a band too few have settled in", () => {
    const crowd = [...settled(MIN_SETTLED - 1, 0), ...waiting(1, 0)];
    expect(namesakeEstimate(crowd).expectedNamesakes).toBeNull();
  });
});

describe("the bands, the crops and the pages touched", () => {
  it("bands surnames by their bearers", () => {
    expect([0, 49, 50, 999, 1_000, 19_999, 20_000].map(bandOf)).toEqual([
      0, 0, 1, 1, 2, 3, 4,
    ]);
  });

  it("reads a crop's stored fields, a word it does not know as none", () => {
    const record = cropRecordOf({
      status: "agreed",
      personIds: ["jan-old", 7, ""],
      pageOutcomes: { "jan-old": "queued", ewa: "maybe" },
      agreed: { value: "1970-05-05", kind: "date" },
      candidacyKeys: ["a1"],
      createdAt: { toMillis: () => FACTS_AT },
    });
    expect(record.personIds).toEqual(["jan-old"]);
    expect([...record.pageOutcomes]).toEqual([
      ["jan-old", "queued"],
      ["ewa", null],
    ]);
    expect(record.value).toBe("1970-05-05");
    expect(record.createdAt).toBe(FACTS_AT);
    expect(cropRecordOf({ status: "pending-review" }).status).toBeNull();
    expect(
      [new Date(FACTS_AT), "2026-11-17T05:15:00.000Z", "soon", undefined].map(
        (createdAt) => cropRecordOf({ createdAt }).createdAt,
      ),
    ).toEqual([FACTS_AT, FACTS_AT, null, null]);
  });

  it("knows when the newest crop of each candidacy reached the site", () => {
    const index = indexCrops(
      [
        crop(["a"], { candidacyKeys: ["k1", "k2"], createdAt: FACTS_AT - 1 }),
        crop(["a"], { candidacyKeys: ["k2"], createdAt: FACTS_AT + 1 }),
        crop(["b"], { candidacyKeys: ["k3"] }),
      ],
      (page) => page,
    );

    expect([
      ...arrivedSince(["k1", "k2", "k3", "k4"], index, FACTS_AT),
    ]).toEqual(["k2"]);
    // Facts of an unknown age move nobody.
    expect(arrivedSince(["k2"], index, Number.NaN).size).toBe(0);
  });

  it("does not read an entry with a field or a stage it has no word for", () => {
    const entry = {
      stage: "held",
      detail: "queued",
      band: 4,
      publishedOn: null,
      unit: "021704",
      unitName: "",
      keys: ["k"],
      candidacies: [candidacyOf(fact("k", "p"))],
      at: 1,
    };

    expect(personEntrySchema.safeParse(entry).success).toBe(true);
    for (const newer of [
      { ...entry, stage: "queued" },
      { ...entry, aliases: ["p-old"] },
      { ...entry, candidacies: [{ ...entry.candidacies[0], kids: ["p"] }] },
    ]) {
      expect(personEntrySchema.safeParse(newer).success).toBe(false);
    }
  });

  it("files a crop of a page merged since under the page it went into", () => {
    const index = indexCrops(
      [
        crop(["jan-old"], {
          outcomes: { "jan-old": "queued" },
          candidacyKeys: ["a1"],
        }),
      ],
      (page) => (page === "jan-old" ? "jan" : page),
    );
    expect(index.byPage.get("jan")).toEqual([
      { status: "agreed", outcome: "queued", value: "1970-05-05" },
    ]);
    expect(namedElsewhere("jan", ["a1"], index)).toBe(false);
    expect(namedElsewhere("ewa", ["a1"], index)).toBe(true);
  });

  it("lists every page a comparison, a pass and a sweep touched, once", () => {
    expect(
      pagesTouched({
        matched: [{ outcomes: { jan: "queued", ewa: "different" } }],
        drain: {
          published: ["jan"],
          held: [{ personId: "ola", reason: "two_pages" }],
          confirmed: ["piotr"],
          failed: ["adam"],
        },
        reverted: {
          restored: ["zofia"],
          held: [{ personId: "maria", reason: "no_revision" }],
        },
      }),
    ).toEqual(["jan", "ewa", "ola", "piotr", "adam", "zofia", "maria"]);
    expect(pagesTouched({ drain: { published: [] } })).toEqual([]);
  });
});
