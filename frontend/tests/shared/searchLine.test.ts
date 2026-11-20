import { describe, it, expect } from "vitest";
import {
  companyName,
  hitLine,
  hitLineText,
  personSearchLine,
  placeName,
  storedSearchLines,
  type LineEdge,
  type LineTarget,
  type SearchLineNode,
} from "../../shared/searchLine";

const TODAY = Date.parse("2026-11-18T00:00:00Z");

/** The nodes of a small piece of the map around Mielec and a few other
 * towns, shaped as /api/stats/computeNodes hands them over. */
const NODES: Record<string, LineTarget> = {
  teryt18: { type: "region", name: "podkarpackie", teryt: "18" },
  teryt1811: { type: "region", name: "Powiat mielecki", teryt: "1811" },
  teryt1811011: { type: "region", name: "Gmina Mielec", teryt: "1811011" },
  teryt2475: { type: "region", name: "Sosnowiec", teryt: "2475" },
  teryt2216: { type: "region", name: "Powiat sztumski", teryt: "2216" },
  teryt2413: { type: "region", name: "Powiat tarnogórski", teryt: "2413" },
  teryt2413082: { type: "region", name: "Gmina Tworóg", teryt: "2413082" },
  teryt2413011: {
    type: "region",
    name: "Gmina Tarnowskie Góry",
    teryt: "2413011",
  },
  mzbm: {
    type: "place",
    name: "MIEJSKI ZARZĄD BUDYNKÓW MIESZKALNYCH (Mielec)",
    seat: "teryt1811",
  },
  wodnik: {
    type: "place",
    name: 'PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI "WODNIK" (Jelenia Góra)',
  },
  szpital: {
    type: "place",
    name: "WOJEWÓDZKI SZPITAL SPECJALISTYCZNY NR 5 W SOSNOWCU",
    seat: "teryt2475",
  },
  cech: {
    type: "place",
    name: "CECH RZEMIOSŁ RÓŻNYCH W SZTUMIE",
    seat: "teryt2216",
  },
  zuk: {
    type: "place",
    name: "ZAKŁAD USŁUG KOMUNALNYCH - TWORÓG",
    seat: "teryt2413",
    owners: ["teryt2413082"],
  },
  wodociagi: {
    type: "place",
    name: "WODOCIĄGI POWIATU TARNOGÓRSKIEGO",
    seat: "teryt2413",
    // Two gminy, one of them a town: the town is the company's.
    owners: ["teryt2413082", "teryt2413011"],
  },
  gone: { type: "place", name: "SPÓŁKA ZLIKWIDOWANA (Mielec)", deleted: true },
};
const targets = new Map(Object.entries(NODES));

const run = (id: string, fields: Partial<LineEdge> = {}): LineEdge => ({
  id,
  source: "p1",
  type: "election",
  target: "teryt1811",
  position: "Rada miasta",
  start_date: "2024-01-01",
  ...fields,
});

const post = (id: string, fields: Partial<LineEdge> = {}): LineEdge => ({
  id,
  source: "p1",
  type: "employed",
  target: "mzbm",
  name: "Rada Nadzorcza",
  start_date: "2018-07-02",
  ...fields,
});

describe("placeName", () => {
  it("says a region the way a line does", () => {
    expect(placeName("Gmina Mielec")).toBe("Mielec");
    expect(placeName("Miasto Warszawa")).toBe("Warszawa");
    expect(placeName("Powiat mielecki")).toBe("powiat mielecki");
    expect(placeName("Województwo mazowieckie")).toBe("mazowieckie");
    expect(placeName("Kraków")).toBe("Kraków");
  });
});

describe("companyName", () => {
  it("leaves the town of its bracket for the start of the line", () => {
    expect(companyName("TAURON DYSTRYBUCJA (Kraków)")).toBe(
      "TAURON DYSTRYBUCJA",
    );
  });

  it("calls a company by the name in its quotes where it has one", () => {
    expect(
      companyName(
        'PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI "WODNIK" (Jelenia Góra)',
      ),
    ).toBe("„WODNIK”");
  });
});

describe("personSearchLine", () => {
  it("leads with a seat won in the newest election, in the town of a post inside its powiat", () => {
    // Every local run is filed under its powiat. Mielec's councillor also sat
    // on the board of a company in Mielec, so the run is Mielec's.
    const line = personSearchLine(
      [
        run("seat", { elected: true }),
        post("board", { end_date: "2019-06-26" }),
      ],
      targets,
      TODAY,
    );
    expect(line).toEqual({
      where: "Mielec",
      what: "Rada miasta",
      when: "2024",
      ties: ["teryt1811", "mzbm"],
      election: "local-2024:won",
    });
  });

  it("keeps the powiat where no tie inside it names a town", () => {
    expect(
      personSearchLine([run("seat", { elected: true })], targets, TODAY),
    ).toMatchObject({ where: "powiat mielecki", what: "Rada miasta" });
  });

  it("names a post held now ahead of a seat from an earlier term", () => {
    const line = personSearchLine(
      [
        run("2018", {
          elected: true,
          position: "Prezydent",
          start_date: "2018-01-01",
        }),
        post("held", { target: "wodnik", start_date: "2021-06-14" }),
      ],
      targets,
      TODAY,
    );
    expect(line).toEqual({
      where: "Jelenia Góra",
      what: "„WODNIK”",
      ties: ["wodnik"],
    });
  });

  it("says when a post ended, and takes it over an older run", () => {
    const line = personSearchLine(
      [
        run("2018", { start_date: "2018-01-01" }),
        post("ended", {
          target: "wodnik",
          start_date: "2021-06-14",
          end_date: "2025-02-26",
        }),
      ],
      targets,
      TODAY,
    );
    expect(line).toMatchObject({
      where: "Jelenia Góra",
      what: "„WODNIK”",
      when: "do 2025",
    });
  });

  it("never calls a run that won nothing by its office", () => {
    // „Prezydent” over a lost race would read as the job.
    const line = personSearchLine(
      [run("lost", { position: "Prezydent" })],
      targets,
      TODAY,
    );
    expect(line).toMatchObject({ what: "wybory", election: "local-2024" });
  });

  it("finds the town of a company by its seat, or by the one gmina owning it", () => {
    const at = (company: string) =>
      personSearchLine([post("p", { target: company })], targets, TODAY)?.where;
    expect(at("szpital")).toBe("Sosnowiec");
    expect(at("zuk")).toBe("Tworóg");
    expect(at("wodociagi")).toBe("Tarnowskie Góry");
    // A seat that is a powiat names no town, and nothing guesses one.
    expect(at("cech")).toBe("powiat sztumski");
  });

  it("passes over a removed tie and a company that is gone", () => {
    expect(
      personSearchLine(
        [
          run("removed", { elected: true, deleted: true }),
          post("gone", { target: "gone" }),
          post("missing", { target: "nowhere" }),
        ],
        targets,
        TODAY,
      ),
    ).toBeUndefined();
  });
});

describe("storedSearchLines", () => {
  const imported = new Set(["p1", "imported-post"]);
  const importedOrReviewed = (doc: { id: string; revision_id?: unknown }) =>
    !!doc.revision_id || imported.has(doc.id);

  /** A seat won in 2024 nobody has published, the post an import wrote, which
   * is published, one added by hand since, and a tie of somebody else's. */
  const ties = [
    { ...run("draft-run", { elected: true }) },
    {
      ...post("imported-post", { target: "wodnik" }),
      published: true,
    },
    // Somebody's say-so: never on the teaser, so never in its line.
    post("added-by-hand", { target: "szpital", start_date: "2023-01-01" }),
    // Somebody else's tie, handed over from the other end.
    { ...post("not-theirs"), source: "p2" },
  ];

  it("works out a line per kind of reader of a published person", () => {
    const lines = storedSearchLines(
      { id: "p1", published: true },
      ties,
      targets,
      importedOrReviewed,
      TODAY,
    );
    expect(lines.approved).toMatchObject({ where: "Jelenia Góra" });
    // A signed in reader sees the seat they hold now.
    expect(lines.all).toMatchObject({
      what: "Rada miasta",
      election: "local-2024:won",
    });
    expect(lines.teaser).toMatchObject({
      where: "Jelenia Góra",
      what: "„WODNIK”",
    });
  });

  it("leads an unpublished person's line with the latest post for a signed in reader too", () => {
    // Decision on 2026-11-18: a draft's run is a PKW match nobody has
    // checked, and often sits on several namesakes at once.
    const lines = storedSearchLines(
      { id: "p1" },
      ties,
      targets,
      importedOrReviewed,
      TODAY,
    );
    expect(lines.all).toMatchObject({
      where: "Sosnowiec",
      what: "WOJEWÓDZKI SZPITAL SPECJALISTYCZNY NR 5 W SOSNOWCU",
      ties: ["szpital"],
    });
    expect(lines.all).not.toHaveProperty("election");
    // And the teaser's post, as ever, for a logged out one.
    expect(lines.teaser).toMatchObject({ what: "„WODNIK”" });
  });

  it("names an unpublished person's run where there is no post at all", () => {
    const lines = storedSearchLines(
      { id: "p1" },
      [run("only-run", { elected: true })],
      targets,
      importedOrReviewed,
      TODAY,
    );
    expect(lines.all).toMatchObject({
      what: "Rada miasta",
      election: "local-2024:won",
    });
    expect(lines.teaser).toBeUndefined();
  });

  it("gives a person added by hand no teaser line, and leaves empty scopes out", () => {
    const lines = storedSearchLines(
      { id: "by-hand" },
      [{ ...post("imported-post", { target: "wodnik" }), source: "by-hand" }],
      targets,
      importedOrReviewed,
      TODAY,
    );
    expect(Object.keys(lines)).toEqual(["all"]);
  });
});

describe("hitLine", () => {
  /** A person as /api/search reads them, with every scope stored and the
   * edge stats current. */
  const person = (fields: Partial<SearchLineNode> = {}): SearchLineNode => ({
    type: "person",
    visibility: true,
    parties: ["PiS", "Inne"],
    stats: {
      searchLine: {
        approved: {
          where: "Mielec",
          what: "Rada miasta",
          when: "2024",
          ties: ["teryt1811", "mzbm"],
          election: "local-2024:won",
        },
        all: { where: "Rzeszów", what: "AGROHURT", ties: ["agrohurt"] },
        teaser: { where: "Jelenia Góra", what: "„WODNIK”", ties: ["wodnik"] },
      },
      edges: {
        approved: {
          targetNodeIds: ["teryt1811", "mzbm"],
          elections: ["local-2024", "local-2024:won"],
        },
        all: {
          targetNodeIds: ["teryt1811", "mzbm", "agrohurt", "wodnik"],
          elections: ["local-2024", "local-2024:won"],
        },
      },
    },
    ...fields,
  });

  it("tells a logged out reader the published line, with the parties the page shows", () => {
    expect(hitLine(person(), false)).toEqual({
      where: "Mielec",
      what: "Rada miasta",
      when: "2024",
      parties: ["PiS"],
    });
  });

  it("tells a logged out reader of a draft only what its teaser shows", () => {
    // No party: on a draft it is a PKW match nobody has checked.
    expect(hitLine(person({ visibility: false }), false)).toEqual({
      where: "Jelenia Góra",
      what: "„WODNIK”",
    });
  });

  it("tells a signed in reader the line over every tie", () => {
    expect(hitLine(person({ visibility: false }), true)).toEqual({
      where: "Rzeszów",
      what: "AGROHURT",
    });
    expect(hitLine(person(), true)).toMatchObject({ parties: ["PiS"] });
  });

  it("drops a line whose tie has left the person since it was stored", () => {
    // A namesake's run taken off the page must not go on naming them.
    const taken = person();
    taken.stats!.edges!.approved = {
      targetNodeIds: ["mzbm"],
      elections: [],
    };
    expect(hitLine(taken, false)).toEqual({ parties: ["PiS"] });
  });

  it("drops a line about a run whose election the person no longer has", () => {
    const lost = person();
    lost.stats!.edges!.approved!.elections = ["local-2024"];
    expect(hitLine(lost, false)).toEqual({ parties: ["PiS"] });
  });

  it("reads the stored arrays however they were written", () => {
    // Documents written before 2026-07-28 hold arrays as maps.
    const old = person();
    old.stats!.edges!.approved = {
      targetNodeIds: { 0: "teryt1811", 1: "mzbm" },
      elections: { 0: "local-2024:won" },
    };
    expect(hitLine(old, false)).toMatchObject({ where: "Mielec" });
  });

  it("says nothing of a person with no line and no party, or of a company", () => {
    expect(
      hitLine({ type: "person", visibility: true, stats: {} }, false),
    ).toBeUndefined();
    expect(hitLine({ ...person(), type: "place" }, false)).toBeUndefined();
  });
});

describe("hitLineText", () => {
  it("puts the town first, then the parties, then what and when", () => {
    expect(
      hitLineText({
        where: "Mielec",
        parties: ["PiS"],
        what: "Rada miasta",
        when: "2024",
      }),
    ).toBe("Mielec · PiS · Rada miasta 2024");
    expect(
      hitLineText({ where: "Jelenia Góra", what: "„WODNIK”", when: "do 2025" }),
    ).toBe("Jelenia Góra · „WODNIK” do 2025");
    expect(hitLineText({ parties: ["PiS"] })).toBe("PiS");
    expect(hitLineText(undefined)).toBe("");
  });
});
