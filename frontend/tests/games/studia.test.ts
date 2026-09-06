import { describe, it, expect } from "vitest";
import {
  pickStudiaTarget,
  studiaCandidates,
  studiaCvs,
  studiaMinCvEntries,
  studiaSquares,
  type StudiaEdgeLike,
  type StudiaPersonLike,
} from "../../shared/games/studia";
import {
  educationIndex,
  type EducationTerm,
} from "../../shared/games/education";
import { puzzleNumber } from "../../shared/games/engine";
import { gameEntry } from "../../shared/games/registry";

/** A vocabulary of its own rather than the shipped one: these tests are about
 * who gets asked about, and pinning them to real terms would make an ordinary
 * edit to `educationVocabulary.ts` fail a test that has nothing to do with it. */
const vocabulary: EducationTerm[] = [
  {
    term: "magister prawa",
    level: "magister",
    path: ["prawnicze", "prawo", "prawo"],
    aliases: ["prawnik"],
  },
  {
    term: "technik budowlany",
    level: "średnie",
    path: ["techniczne", "budownictwo", "ogólne"],
  },
];
const index = educationIndex(vocabulary);

const person = (
  id: string,
  education: string | undefined,
  overrides: Partial<StudiaPersonLike> = {},
): StudiaPersonLike => ({
  id,
  name: `Osoba ${id}`,
  visibility: true,
  education,
  ...overrides,
});

const employed = (source: string, target: string): StudiaEdgeLike => ({
  type: "employed",
  source,
  target,
  name: "Zarząd",
  visibility: true,
  start_date: "2019-04-01",
});

const places = {
  firma: { visibility: true, activity: ["36"] },
  ukryta: { visibility: false, activity: ["36"] },
};
const regions = { teryt22: { name: "Województwo Pomorskie" } };

describe("studiaCandidates", () => {
  it("takes only people whose education resolves to a term", () => {
    const found = studiaCandidates(
      [
        person("a", "magister prawa"),
        person("b", "prawnik"), // an alias, which must resolve to the same term
        person("c", "zaklinacz deszczu"), // nothing in the vocabulary
        person("d", undefined),
        person("e", "   "),
      ],
      index,
    );
    expect(found.map((c) => c.id)).toEqual(["a", "b"]);
    expect(found.every((c) => c.term.term === "magister prawa")).toBe(true);
  });

  it("leaves out anybody the site does not show", () => {
    const found = studiaCandidates(
      [
        person("hidden", "magister prawa", { visibility: false }),
        person("gone", "magister prawa", { deleted: true }),
        person("nameless", "magister prawa", { name: undefined }),
        person("shown", "magister prawa"),
      ],
      index,
    );
    expect(found.map((c) => c.id)).toEqual(["shown"]);
  });
});

describe("studiaCvs", () => {
  const eligible = new Set(["a"]);

  it("names an employer by its branża and never by its name", () => {
    const cvs = studiaCvs([employed("a", "firma")], eligible, places, regions);
    const cv = cvs.get("a")!;
    expect(cv).toHaveLength(1);
    expect(cv[0]!.kind).toBe("praca");
    expect(cv[0]!.what).not.toContain("firma");
    expect(cv[0]!.what.length).toBeGreaterThan(0);
    expect(cv[0]!.from).toBe("2019");
  });

  it("skips an employer the site does not show", () => {
    const cvs = studiaCvs([employed("a", "ukryta")], eligible, places, regions);
    expect(cvs.get("a")).toBeUndefined();
  });

  it("skips an edge the site does not show", () => {
    const hidden = { ...employed("a", "firma"), visibility: false };
    expect(
      studiaCvs([hidden], eligible, places, regions).get("a"),
    ).toBeUndefined();
  });

  it("keeps an election as its office, its okręg and its party", () => {
    const cvs = studiaCvs(
      [
        {
          type: "election",
          source: "a",
          target: "teryt22",
          position: "Sejmik",
          party: "PO",
          visibility: true,
          start_date: "2018-01-01",
        },
      ],
      eligible,
      places,
      regions,
    );
    expect(cvs.get("a")![0]).toMatchObject({
      kind: "wybory",
      what: "Sejmik",
      role: "okręg: Województwo Pomorskie",
      party: "PO",
      from: "2018",
    });
  });

  it("reads oldest first", () => {
    const cvs = studiaCvs(
      [
        { ...employed("a", "firma"), start_date: "2021-01-01" },
        { ...employed("a", "firma"), start_date: "2011-01-01" },
        { ...employed("a", "firma"), start_date: "2016-01-01" },
      ],
      eligible,
      places,
      regions,
    );
    expect(cvs.get("a")!.map((entry) => entry.from)).toEqual([
      "2011",
      "2016",
      "2021",
    ]);
  });

  it("ignores everybody outside the eligible set", () => {
    const cvs = studiaCvs([employed("z", "firma")], eligible, places, regions);
    expect(cvs.size).toBe(0);
  });
});

describe("pickStudiaTarget", () => {
  const cv = (id: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...employed(id, "firma"),
      start_date: `20${10 + i}-01-01`,
    }));

  it("says there is nobody rather than asking about a one-line CV", () => {
    expect(
      pickStudiaTarget(
        [person("a", "magister prawa")],
        cv("a", studiaMinCvEntries - 1),
        places,
        regions,
        index,
        "2026-09-06",
      ),
    ).toBeNull();
  });

  it("asks about somebody whose CV has a shape", () => {
    const target = pickStudiaTarget(
      [person("a", "magister prawa")],
      cv("a", studiaMinCvEntries),
      places,
      regions,
      index,
      "2026-09-06",
    );
    expect(target).toMatchObject({ personId: "a", personName: "Osoba a" });
    expect(target!.term.term).toBe("magister prawa");
    expect(target!.cv).toHaveLength(studiaMinCvEntries);
  });

  it("says there is nobody when nobody has an education at all", () => {
    expect(
      pickStudiaTarget(
        [person("a", undefined)],
        cv("a", 5),
        places,
        regions,
        index,
        "2026-09-06",
      ),
    ).toBeNull();
  });

  it("answers the same day with the same person, however often it is asked", () => {
    const people = ["a", "b", "c", "d"].map((id) =>
      person(id, id < "c" ? "magister prawa" : "technik budowlany"),
    );
    const edges = people.flatMap((p) => cv(p.id!, 3));
    const once = pickStudiaTarget(
      people,
      edges,
      places,
      regions,
      index,
      "2026-09-11",
    );
    const twice = pickStudiaTarget(
      [...people].reverse(), // a different order out of Firestore must not matter
      edges,
      places,
      regions,
      index,
      "2026-09-11",
    );
    expect(once!.personId).toBe(twice!.personId);
  });

  it("goes round the whole pool before asking about anybody twice", () => {
    // The reason the game can ship on nine people: a day is one person, so a
    // repeat inside a week would read as the game being broken.
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const people = ids.map((id) => person(id, "magister prawa"));
    const edges = people.flatMap((p) => cv(p.id!, 3));
    const first = gameEntry("studia").firstDay;

    const days: string[] = [];
    for (let i = 0; i < ids.length * 3; i++) {
      const date = new Date(Date.parse(first) + i * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      days.push(
        pickStudiaTarget(people, edges, places, regions, index, date)!.personId,
      );
      // the dates really are consecutive puzzle numbers
      expect(puzzleNumber(first, date)).toBe(i + 1);
    }

    for (let lap = 0; lap < 3; lap++) {
      const window = days.slice(lap * ids.length, (lap + 1) * ids.length);
      expect(new Set(window).size).toBe(ids.length);
    }
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).not.toBe(days[i - 1]);
    }
  });
});

describe("studiaSquares", () => {
  it("gets greener the fewer guesses it took", () => {
    expect(studiaSquares(1)).toBe("🟩🟩🟩");
    expect(studiaSquares(5)).toBe("🟩🟩⬜");
    expect(studiaSquares(12)).toBe("🟩⬜⬜");
    expect(studiaSquares(40)).toBe("⬜⬜⬜");
  });
});
