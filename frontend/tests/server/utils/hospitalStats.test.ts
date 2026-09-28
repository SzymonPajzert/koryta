import { describe, it, expect } from "vitest";
import {
  boardSeats,
  buildHospitalStats,
  isPublicHospital,
  isSupervisoryRole,
  NO_PARTY,
  NO_REGION,
  type BoardEdgeRow,
  type BoardPersonRow,
  type HospitalPlaceRow,
} from "../../../server/utils/hospitalStats";

function place(
  id: string,
  overrides: Partial<HospitalPlaceRow> = {},
): HospitalPlaceRow {
  return {
    id,
    name: id,
    published: true,
    isPublic: true,
    categories: ["szpitale"],
    ...overrides,
  };
}

function seat(
  personId: string,
  placeId: string,
  overrides: Partial<BoardEdgeRow> = {},
): BoardEdgeRow {
  return {
    source: personId,
    target: placeId,
    name: "Rada Nadzorcza",
    published: true,
    ...overrides,
  };
}

function person(
  id: string,
  parties: string[] | Record<string, string> | undefined,
  overrides: Partial<BoardPersonRow> = {},
): BoardPersonRow {
  return { id, name: id, parties, published: true, ...overrides };
}

const build = (input: {
  places: HospitalPlaceRow[];
  edges?: BoardEdgeRow[];
  people?: BoardPersonRow[];
}) =>
  buildHospitalStats({
    places: input.places,
    edges: input.edges ?? [],
    people: input.people ?? [],
    generatedAt: "2026-08-22T00:00:00.000Z",
    today: "2026-08-22",
  });

describe("isPublicHospital", () => {
  it("counts a published, publicly owned place tagged szpitale", () => {
    expect(isPublicHospital(place("a"))).toBe(true);
  });

  it("reads a category array stored as a numbered-key object", () => {
    // sanitizeFirestoreData writes arrays that way, and array-contains cannot
    // match them - which is why the filter runs in memory at all.
    expect(
      isPublicHospital(place("a", { categories: { "0": "szpitale" } })),
    ).toBe(true);
  });

  it("leaves out a draft, a place nobody tagged, and one nobody has shown to be public", () => {
    expect(isPublicHospital(place("a", { published: false }))).toBe(false);
    expect(isPublicHospital(place("a", { deleted: true }))).toBe(false);
    expect(isPublicHospital(place("a", { categories: ["wodociagi"] }))).toBe(
      false,
    );
    // `false` and absent both mean "no evidence", and this page names people.
    expect(isPublicHospital(place("a", { isPublic: false }))).toBe(false);
    expect(isPublicHospital(place("a", { isPublic: undefined }))).toBe(false);
  });
});

describe("isSupervisoryRole", () => {
  it("recognises the role the KRS pipeline writes, however it is spaced", () => {
    expect(isSupervisoryRole("Rada Nadzorcza")).toBe(true);
    expect(isSupervisoryRole("rada  nadzorcza ")).toBe(true);
    expect(isSupervisoryRole("Rada Nadzorcza (przewodniczący)")).toBe(true);
    expect(isSupervisoryRole("Rada Społeczna")).toBe(true);
  });

  it("is not every job at the hospital", () => {
    expect(isSupervisoryRole("Zarząd")).toBe(false);
    expect(isSupervisoryRole("Prokurent")).toBe(false);
    expect(isSupervisoryRole(undefined)).toBe(false);
    expect(isSupervisoryRole("")).toBe(false);
  });
});

describe("boardSeats", () => {
  it("counts one person on one board once, however many spells are recorded", () => {
    // Two open spells: a re-appointment, or the same one recorded twice. One
    // seat either way - a board cannot hold more members than it has chairs.
    const { current } = boardSeats(
      [seat("p1", "h1"), seat("p1", "h1", { name: "Rada Nadzorcza" })],
      "2026-08-22",
    );
    expect(current).toEqual([{ placeId: "h1", personId: "p1" }]);
  });

  it("puts a finished spell aside instead of counting it", () => {
    const { current, ended } = boardSeats(
      [seat("p1", "h1", { end_date: "2020-05-01" })],
      "2026-08-22",
    );
    expect(current).toEqual([]);
    expect(ended).toEqual([{ placeId: "h1", personId: "p1" }]);
  });

  it("lets an open spell outrank a finished one for the same seat", () => {
    const { current, ended } = boardSeats(
      [seat("p1", "h1", { end_date: "2020-05-01" }), seat("p1", "h1")],
      "2026-08-22",
    );
    expect(current).toHaveLength(1);
    expect(ended).toEqual([]);
  });

  it("skips unpublished edges and roles that are not board seats", () => {
    const { current } = boardSeats(
      [
        seat("p1", "h1", { published: false }),
        seat("p2", "h1", { name: "Zarząd" }),
        seat("p3", "h1", { name: undefined }),
      ],
      "2026-08-22",
    );
    expect(current).toEqual([]);
  });
});

describe("buildHospitalStats", () => {
  it("splits the hospitals by what supervises them, not by the edge role", () => {
    // Both edges say "Rada Nadzorcza" - rejestr.io labels every supervisory
    // connection that way. Only the company field knows which seat is paid.
    const stats = build({
      places: [
        place("paid", { supervisoryOrgan: "rada_nadzorcza" }),
        place("unpaid", { supervisoryOrgan: "rada_spoleczna" }),
        place("silent", { supervisoryOrgan: "brak" }),
        place("unread"),
      ],
      edges: [
        seat("p1", "paid"),
        seat("p2", "unpaid"),
        seat("p3", "silent"),
        seat("p4", "unread"),
      ],
      people: [
        person("p1", ["PiS"]),
        person("p2", ["PO"]),
        person("p3", ["PSL"]),
        person("p4", ["PSL"]),
      ],
    });

    expect(stats.hospitals).toBe(4);
    expect(stats.paid.hospitals).toBe(1);
    expect(stats.paid.seats).toBe(1);
    expect(stats.unpaid.hospitals).toBe(1);
    expect(stats.unpaid.seats).toBe(1);
    // "no organ registered" is not evidence of a paid one: most SPZOZ never
    // file their rada społeczna, so those sit out of both breakdowns.
    expect(stats.other.hospitals).toBe(2);
    expect(stats.other.seats).toBe(2);
    expect(stats.paid.byParty).toEqual([
      { party: "PiS", seats: 1, people: 1, hospitals: 1 },
    ]);
    expect(stats.paid.rows).toEqual([
      {
        id: "paid",
        name: "paid",
        supervisoryOrgan: "rada_nadzorcza",
        legalForm: null,
        seats: 1,
        unreviewed: 0,
        parties: ["PiS"],
        byParty: [{ party: "PiS", seats: 1, people: 1, hospitals: 1 }],
      },
    ]);
  });

  it("counts a seat under every party its holder carries, and says how many it could attribute", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1"), seat("p2", "h1"), seat("p3", "h1")],
      people: [
        person("p1", ["PO", "Nowa Lewica"]),
        person("p2", ["PO"]),
        person("p3", []),
      ],
    });

    expect(stats.paid.seats).toBe(3);
    expect(stats.paid.seatsWithParty).toBe(2);
    expect(stats.paid.byParty).toEqual([
      { party: "PO", seats: 2, people: 2, hospitals: 1 },
      { party: "Nowa Lewica", seats: 1, people: 1, hospitals: 1 },
      { party: NO_PARTY, seats: 1, people: 1, hospitals: 1 },
    ]);
  });

  /** „Inne” is a tie to some party the site does not name, so it is counted as
   * attributed - but drawn grey, and a bar reads the parties it names first
   * and its greys side by side at the end, however big „Inne” gets. */
  it("puts „Inne” after the parties it names and before the sentinel", () => {
    const stats = build({
      places: [
        place("h1", { supervisoryOrgan: "rada_nadzorcza", regionTeryt: "14" }),
      ],
      edges: ["a", "b", "c", "d", "e"].map((id) => seat(id, "h1")),
      people: [
        person("a", ["Inne"]),
        person("b", ["Inne"]),
        person("c", ["Inne"]),
        person("d", ["PiS"]),
        person("e", []),
      ],
    });

    expect(stats.paid.seatsWithParty).toBe(4);
    const order = [
      { party: "PiS", seats: 1, people: 1, hospitals: 1 },
      { party: "Inne", seats: 3, people: 3, hospitals: 1 },
      { party: NO_PARTY, seats: 1, people: 1, hospitals: 1 },
    ];
    expect(stats.paid.byParty).toEqual(order);
    expect(stats.paid.byRegion[0]!.byParty).toEqual(order);
    expect(stats.paid.rows[0]!.parties).toEqual(["PiS", "Inne", NO_PARTY]);
  });

  it("reads parties stored as a numbered-key object", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1")],
      people: [person("p1", { "0": "PiS" })],
    });
    expect(stats.paid.byParty).toEqual([
      { party: "PiS", seats: 1, people: 1, hospitals: 1 },
    ]);
  });

  it("keeps the seat but not the party when the person is still a draft", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1")],
      people: [person("p1", ["PiS"], { published: false })],
    });
    expect(stats.paid.seats).toBe(1);
    expect(stats.paid.seatsWithParty).toBe(0);
    expect(stats.paid.byParty).toEqual([
      { party: NO_PARTY, seats: 1, people: 1, hospitals: 1 },
    ]);
  });

  it("shows how many boards it has actually observed", () => {
    const stats = build({
      places: [
        place("h1", { supervisoryOrgan: "rada_nadzorcza" }),
        place("h2", { supervisoryOrgan: "rada_nadzorcza" }),
      ],
      edges: [seat("p1", "h1"), seat("p1", "h1", { end_date: "2020-01-01" })],
      people: [person("p1", ["PiS"])],
    });
    expect(stats.paid.hospitals).toBe(2);
    // A party with few seats may just be unobserved, so the denominator ships
    // with the numbers.
    expect(stats.paid.hospitalsWithSeats).toBe(1);
    expect(stats.paid.endedSeats).toBe(0);
  });

  it("reports the seats somebody has left without counting them", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1", { end_date: "2020-01-01" })],
      people: [person("p1", ["PiS"])],
    });
    expect(stats.paid.seats).toBe(0);
    expect(stats.paid.endedSeats).toBe(1);
    expect(stats.paid.byParty).toEqual([]);
  });

  it("ignores edges into anything that is not a counted hospital", () => {
    const stats = build({
      places: [
        place("h1", { supervisoryOrgan: "rada_nadzorcza" }),
        place("private", {
          supervisoryOrgan: "rada_nadzorcza",
          isPublic: false,
        }),
      ],
      edges: [seat("p1", "private"), seat("p2", "elsewhere")],
      people: [person("p1", ["PiS"]), person("p2", ["PiS"])],
    });
    expect(stats.hospitals).toBe(1);
    expect(stats.paid.seats).toBe(0);
    expect(stats.paid.byParty).toEqual([]);
  });

  it("names the organ kinds each group covers", () => {
    const stats = build({ places: [] });
    expect(stats.paid.kinds).toEqual(["rada_nadzorcza"]);
    expect(stats.unpaid.kinds).toEqual(["rada_spoleczna"]);
    expect(stats.other.kinds).toEqual([
      "komisja_rewizyjna",
      "inny",
      "nieznany",
      "brak",
    ]);
  });

  it("sorts hospitals by seats and keeps the legal form for the exclusion note", () => {
    const stats = build({
      places: [
        place("small", {
          supervisoryOrgan: "rada_nadzorcza",
          legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        }),
        place("big", {
          supervisoryOrgan: "rada_nadzorcza",
          legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        }),
      ],
      edges: [seat("p1", "big"), seat("p2", "big"), seat("p3", "small")],
      people: [person("p1", ["PO"]), person("p2", ["PO"]), person("p3", [])],
    });
    expect(stats.paid.rows.map((row) => row.id)).toEqual(["big", "small"]);
    expect(stats.paid.rows[0]?.legalForm).toBe(
      "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    );
  });
});

describe("boardSeats: the unreviewed bucket", () => {
  it("counts a sitting seat nobody has published", () => {
    const { current, unreviewed } = boardSeats(
      [seat("p", "h", { published: false })],
      "2026-08-22",
    );
    expect(current).toHaveLength(0);
    expect(unreviewed).toEqual([{ placeId: "h", personId: "p" }]);
  });

  it("leaves out a draft the register says is over", () => {
    // Backlog is work waiting to be done. A spell that ended is not work.
    const { unreviewed } = boardSeats(
      [seat("p", "h", { published: false, end_date: "2020-01-01" })],
      "2026-08-22",
    );
    expect(unreviewed).toHaveLength(0);
  });

  it("leaves out an approved removal", () => {
    const { unreviewed } = boardSeats(
      [seat("p", "h", { published: false, deleted: true })],
      "2026-08-22",
    );
    expect(unreviewed).toHaveLength(0);
  });

  it("counts a pair holding both a draft and a published spell as reviewed", () => {
    const { current, unreviewed } = boardSeats(
      [
        seat("p", "h", { published: false }),
        seat("p", "h", { published: true }),
      ],
      "2026-08-22",
    );
    expect(current).toHaveLength(1);
    expect(unreviewed).toHaveLength(0);
  });

  it("does not double count two drafts for the same pair", () => {
    const { unreviewed } = boardSeats(
      [
        seat("p", "h", { published: false }),
        seat("p", "h", { published: false, name: "Rada Nadzorcza (członek)" }),
      ],
      "2026-08-22",
    );
    expect(unreviewed).toHaveLength(1);
  });

  it("ignores a draft edge that is not a supervisory role", () => {
    const { unreviewed } = boardSeats(
      [seat("p", "h", { published: false, name: "Zarząd" })],
      "2026-08-22",
    );
    expect(unreviewed).toHaveLength(0);
  });
});

describe("buildHospitalStats: by województwo", () => {
  const mazowieckie = place("h1", {
    supervisoryOrgan: "rada_nadzorcza",
    regionTeryt: "1465",
  });
  const alsoMazowieckie = place("h2", {
    supervisoryOrgan: "rada_nadzorcza",
    regionTeryt: "14",
  });
  const pomorskie = place("h3", {
    supervisoryOrgan: "rada_nadzorcza",
    regionTeryt: "2261",
  });

  it("rolls a gmina and a powiat code up into one województwo row", () => {
    const stats = buildHospitalStats({
      places: [mazowieckie, alsoMazowieckie],
      edges: [],
      people: [],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
      wojewodztwoNames: { "14": "Województwo mazowieckie" },
    });
    expect(stats.paid.byRegion).toHaveLength(1);
    expect(stats.paid.byRegion[0]).toMatchObject({
      teryt: "14",
      name: "Województwo mazowieckie",
      groupHospitals: 2,
    });
  });

  it("normalises a name stored without the prefix", () => {
    const stats = buildHospitalStats({
      places: [pomorskie],
      edges: [],
      people: [],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
      wojewodztwoNames: { "22": "pomorskie" },
    });
    expect(stats.paid.byRegion[0]!.name).toBe("Województwo pomorskie");
  });

  it("keeps a region whose node it could not name", () => {
    const stats = buildHospitalStats({
      places: [pomorskie],
      edges: [],
      people: [],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    expect(stats.paid.byRegion[0]!.name).toBe("Województwo 22");
  });

  it("parks a hospital the register places nowhere under the sentinel", () => {
    const stats = buildHospitalStats({
      places: [place("h9", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [],
      people: [],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    expect(stats.paid.byRegion[0]!.teryt).toBe(NO_REGION);
  });

  it("splits reviewed seats by party and the backlog by count alone", () => {
    const stats = buildHospitalStats({
      places: [mazowieckie, pomorskie],
      edges: [
        seat("known", "h1"),
        seat("draft1", "h1", { published: false }),
        seat("draft2", "h1", { published: false }),
        seat("draft3", "h3", { published: false }),
      ],
      people: [
        person("known", ["PiS"]),
        // Carries a party, but nobody has published them - so the party must
        // not reach the response at all.
        person("draft1", ["PO"], { published: false }),
        person("draft2", ["PO"], { published: false }),
        person("draft3", ["PSL"], { published: false }),
      ],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
      wojewodztwoNames: { "14": "mazowieckie", "22": "pomorskie" },
    });

    const maz = stats.paid.byRegion.find((row) => row.teryt === "14")!;
    expect(maz).toMatchObject({ seats: 1, unreviewed: 2, seatsWithParty: 1 });
    expect(maz.byParty).toEqual([
      { party: "PiS", seats: 1, people: 1, hospitals: 1 },
    ]);

    const pom = stats.paid.byRegion.find((row) => row.teryt === "22")!;
    expect(pom).toMatchObject({ seats: 0, unreviewed: 1 });
    // The whole point: a region with only drafts says how many, and nothing
    // whatever about who they are.
    expect(pom.byParty).toEqual([]);

    // And no party of an unpublished person appears anywhere in the response.
    expect(JSON.stringify(stats)).not.toContain("PSL");
    expect(JSON.stringify(stats)).not.toContain("PO");
  });

  it("keeps every region row summing to its group total", () => {
    const stats = buildHospitalStats({
      places: [mazowieckie, alsoMazowieckie, pomorskie],
      edges: [
        seat("a", "h1"),
        seat("b", "h2"),
        seat("c", "h3", { published: false }),
        seat("d", "h1", { published: false }),
      ],
      people: [person("a", ["PO"]), person("b", undefined)],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    const sum = (key: "seats" | "unreviewed") =>
      stats.paid.byRegion.reduce((total, row) => total + row[key], 0);
    expect(sum("seats")).toBe(stats.paid.seats);
    expect(sum("unreviewed")).toBe(stats.paid.unreviewed);
    expect(
      stats.paid.byRegion.reduce((t, row) => t + row.groupHospitals, 0),
    ).toBe(stats.paid.hospitals);
  });

  it("counts hospitals of every organ in `hospitals` but only its own in `groupHospitals`", () => {
    const stats = buildHospitalStats({
      places: [
        mazowieckie,
        place("h4", { supervisoryOrgan: "rada_spoleczna", regionTeryt: "14" }),
      ],
      edges: [],
      people: [],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    expect(stats.paid.byRegion[0]).toMatchObject({
      hospitals: 2,
      groupHospitals: 1,
    });
    expect(stats.unpaid.byRegion[0]).toMatchObject({
      hospitals: 2,
      groupHospitals: 1,
    });
  });
});

describe("buildHospitalStats: parties that stand for the same thing", () => {
  const paid = place("h", {
    supervisoryOrgan: "rada_nadzorcza",
    regionTeryt: "14",
  });

  it("counts SLD under Nowa Lewica, so the two share one bar", () => {
    // The site paints both #D40E20, which made them two bars nobody could tell
    // apart and could not add up either.
    const stats = buildHospitalStats({
      places: [paid],
      edges: [seat("a", "h"), seat("b", "h")],
      people: [person("a", ["SLD"]), person("b", ["Nowa Lewica"])],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    expect(stats.paid.byParty).toEqual([
      { party: "Nowa Lewica", seats: 2, people: 2, hospitals: 1 },
    ]);
  });

  it("counts a person carrying both labels once, not twice", () => {
    // One person, one seat. Folding without deduplicating would have made the
    // merged bar twice as long as the board it describes.
    const stats = buildHospitalStats({
      places: [paid],
      edges: [seat("a", "h")],
      people: [person("a", ["SLD", "Nowa Lewica"])],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    expect(stats.paid.seats).toBe(1);
    expect(stats.paid.seatsWithParty).toBe(1);
    expect(stats.paid.byParty).toEqual([
      { party: "Nowa Lewica", seats: 1, people: 1, hospitals: 1 },
    ]);
  });

  it("merges in the region and hospital splits too, not just the total", () => {
    const stats = buildHospitalStats({
      places: [paid],
      edges: [seat("a", "h"), seat("b", "h")],
      people: [person("a", ["SLD"]), person("b", ["Nowa Lewica"])],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    expect(stats.paid.byRegion[0]!.byParty).toEqual([
      { party: "Nowa Lewica", seats: 2, people: 2, hospitals: 1 },
    ]);
    expect(stats.paid.rows[0]!.byParty).toEqual([
      { party: "Nowa Lewica", seats: 2, people: 2, hospitals: 1 },
    ]);
    expect(stats.paid.rows[0]!.parties).toEqual(["Nowa Lewica"]);
  });

  it("leaves every other party alone", () => {
    const stats = buildHospitalStats({
      places: [paid],
      edges: [seat("a", "h")],
      people: [person("a", ["PiS"])],
      generatedAt: "2026-08-22T00:00:00.000Z",
      today: "2026-08-22",
    });
    expect(stats.paid.byParty[0]!.party).toBe("PiS");
  });
});
