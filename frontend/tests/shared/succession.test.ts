import { describe, it, expect } from "vitest";
import {
  gapLabel,
  spellDate,
  successionCandidatesForPerson,
  successionsAtCompany,
  MAX_GAP_DAYS,
  MAX_OVERLAP_DAYS,
  MAX_SEAT_GROUP,
  type SuccessionSpell,
} from "../../shared/succession";

/** A spell, named after who served it so the assertions read as sentences. */
function spell(
  personId: string,
  start: string | null,
  end: string | null,
  role: string | null = "Rada Nadzorcza",
): SuccessionSpell {
  return {
    id: `${personId}-${start ?? "?"}-${role ?? "?"}`,
    personId,
    role,
    start,
    end,
  };
}

/** Who replaced whom, as `"A -> B"`, which is what the tests are about. */
function handovers(spells: SuccessionSpell[]): string[] {
  return successionsAtCompany(spells).map(
    (pair) => `${pair.left.personId} -> ${pair.joined.personId}`,
  );
}

describe("spellDate", () => {
  it("reads an ISO day", () => {
    expect(spellDate("2024-04-12")).toBe(Date.parse("2024-04-12T00:00:00Z"));
  });

  it("refuses everything that is not one", () => {
    // A bare year would land on 1 January and put a spell eleven months from
    // where the register put it; the blank forms are the two spellings of "no
    // date" that /api/edges/create and the edge editor write.
    expect(spellDate("2024")).toBeNull();
    expect(spellDate("")).toBeNull();
    expect(spellDate(null)).toBeNull();
    expect(spellDate(undefined)).toBeNull();
    expect(spellDate("12.04.2024")).toBeNull();
    expect(spellDate("brak")).toBeNull();
  });
});

describe("successionsAtCompany", () => {
  it("pairs a seat handed over on the day", () => {
    const pairs = successionsAtCompany([
      spell("odchodzi", "2020-01-01", "2024-04-12"),
      spell("wchodzi", "2024-04-12", null),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.left.personId).toBe("odchodzi");
    expect(pairs[0]!.joined.personId).toBe("wchodzi");
    expect(pairs[0]!.gapDays).toBe(0);
  });

  it("pairs across a gap up to the tolerance and not past it", () => {
    const at = (days: number) => {
      const start = new Date(
        Date.parse("2024-04-12T00:00:00Z") + days * 86_400_000,
      );
      return start.toISOString().slice(0, 10);
    };

    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12"),
        spell("wchodzi", at(MAX_GAP_DAYS), null),
      ]),
    ).toEqual(["odchodzi -> wchodzi"]);
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12"),
        spell("wchodzi", at(MAX_GAP_DAYS + 1), null),
      ]),
    ).toEqual([]);
  });

  it("tolerates the register filing the two entries out of order", () => {
    // The successor entered before the predecessor was struck off. That is one
    // clerk working through a batch, not two people on one seat.
    const pairs = successionsAtCompany([
      spell("odchodzi", "2020-01-01", "2024-04-12"),
      spell("wchodzi", "2024-03-20", null),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.gapDays).toBe(-23);
  });

  it("does not pair two people who sat on the board together for years", () => {
    expect(
      handovers([
        spell("pierwszy", "2015-01-01", "2024-04-12"),
        spell("drugi", "2016-01-01", null),
      ]),
    ).toEqual([]);
    // The boundary of the same rule.
    expect(MAX_OVERLAP_DAYS).toBe(90);
  });

  it("keeps the management board and the supervisory board apart", () => {
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12", "Zarząd"),
        spell("wchodzi", "2024-04-12", null, "Rada Nadzorcza"),
      ]),
    ).toEqual([]);
  });

  it("treats a role the same however it was capitalised", () => {
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12", "Rada Nadzorcza"),
        spell("wchodzi", "2024-04-12", null, "  rada nadzorcza "),
      ]),
    ).toEqual(["odchodzi -> wchodzi"]);
  });

  it("leaves out a spell whose role nobody recorded", () => {
    // Two unknown roles at one company are not evidence of the same seat.
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12", null),
        spell("wchodzi", "2024-04-12", null, null),
      ]),
    ).toEqual([]);
  });

  it("pairs a whole board changing on one day off rather than squaring it", () => {
    // The shape the register actually produces, and the reason the match is
    // one-to-one: seven out and seven in is seven claims, not forty-nine.
    const spells = [
      ...Array.from({ length: 7 }, (_, i) =>
        spell(`odchodzi${i}`, "2018-01-01", "2024-04-12"),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        spell(`wchodzi${i}`, "2024-04-12", null),
      ),
    ];

    const pairs = successionsAtCompany(spells);

    expect(pairs).toHaveLength(7);
    expect(new Set(pairs.map((p) => p.left.id)).size).toBe(7);
    expect(new Set(pairs.map((p) => p.joined.id)).size).toBe(7);
  });

  it("prefers the closest arrival when several could have taken the seat", () => {
    expect(
      handovers([
        spell("odchodzi", "2018-01-01", "2024-04-12"),
        spell("dwa-miesiace-pozniej", "2024-06-12", null),
        spell("tego-samego-dnia", "2024-04-12", null),
      ]),
    ).toEqual(["odchodzi -> tego-samego-dnia"]);
  });

  it("counts the same spell recorded twice as one seat", () => {
    // 211 duplicate spells in the last register import. Each copy would
    // otherwise hand the one vacated seat over a second time.
    const duplicated = spell("odchodzi", "2020-01-01", "2024-04-12");
    const pairs = successionsAtCompany([
      duplicated,
      { ...duplicated, id: "kopia" },
      spell("wchodzi", "2024-04-12", null),
      spell("tez-wchodzi", "2024-04-12", null),
    ]);

    expect(pairs).toHaveLength(1);
  });

  it("does not let somebody replace themselves", () => {
    expect(
      handovers([
        spell("ta-sama-osoba", "2016-01-01", "2020-04-12"),
        spell("ta-sama-osoba", "2020-04-12", null),
      ]),
    ).toEqual([]);
  });

  it("ignores a spell with no usable date on the side that matters", () => {
    expect(
      handovers([
        spell("wciaz-w-radzie", "2020-01-01", null),
        spell("wchodzi", "2024-04-12", null),
      ]),
    ).toEqual([]);
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12"),
        spell("bez-daty", null, null),
      ]),
    ).toEqual([]);
  });

  it("returns the newest handover first", () => {
    const pairs = successionsAtCompany([
      spell("a", "2010-01-01", "2014-01-01"),
      spell("b", "2014-01-01", "2020-01-01"),
      spell("c", "2020-01-01", null),
    ]);

    expect(pairs.map((p) => p.joined.personId)).toEqual(["c", "b"]);
  });

  it("pairs a same-day batch the same way whatever the edge ids are", () => {
    // Every gap in a board change is zero, so the tie-break decides who the
    // page names as whose predecessor. Keyed on edge ids, that answer moved
    // every time the ingest rewrote the collection - the site would have said
    // one thing this week and another the next with nothing having happened.
    const board = (ids: [string, string, string, string]) => [
      {
        id: ids[0],
        personId: "adam",
        role: "RN",
        start: "2019-03-01",
        end: "2024-04-12",
      },
      {
        id: ids[1],
        personId: "barbara",
        role: "RN",
        start: "2020-06-01",
        end: "2024-04-12",
      },
      {
        id: ids[2],
        personId: "cezary",
        role: "RN",
        start: "2024-04-12",
        end: null,
      },
      {
        id: ids[3],
        personId: "danuta",
        role: "RN",
        start: "2024-04-12",
        end: null,
      },
    ];

    const first = handovers(board(["a", "b", "c", "d"]));
    const reimported = handovers(board(["zz", "yy", "xx", "ww"]));

    expect(first).toEqual(reimported);
    // And the assignment itself follows the register: the member who had sat
    // there longest is filed against the arrival that sorts first.
    expect(first.sort()).toEqual(["adam -> cezary", "barbara -> danuta"]);
  });

  it("does not depend on the order the edges came back in", () => {
    const spells = [
      spell("a", "2010-01-01", "2014-01-01"),
      spell("b", "2014-01-01", "2020-01-01"),
      spell("c", "2020-01-01", null),
    ];

    expect(handovers(spells)).toEqual(handovers([...spells].reverse()));
  });
});

/** The register's own dates, moved by a number of days.
 *
 * Written out rather than hard-coding the answer, because the whole point of
 * the boundary tests below is which side of `MAX_GAP_DAYS` a date falls on,
 * and a reader checking a literal like "2024-08-10" by hand would have to do
 * this arithmetic anyway. */
function plus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Who the rule names on one side, as person ids in the order it returned
 * them - the order being half of what these tests are about. */
function named(candidacies: { other: SuccessionSpell }[]): string[] {
  return candidacies.map((candidacy) => candidacy.other.personId);
}

describe("successionCandidatesForPerson", () => {
  it("gives one joiner every leaver a same-day board change allows", () => {
    // The divergence from the greedy rule, pinned on purpose and in one test
    // so that neither can be changed without reading the other. The page that
    // names a single predecessor still gets two pairs out of these four
    // spells; the page that draws a chain gets both leavers on one side of
    // one person, because the register does not say which chair was whose.
    const board = [
      spell("odchodzi-a", "2018-01-01", "2024-04-12"),
      spell("odchodzi-b", "2018-01-01", "2024-04-12"),
      spell("wchodzi", "2024-04-12", null),
      spell("tez-wchodzi", "2024-04-12", null),
    ];

    const { predecessors, successors } = successionCandidatesForPerson(
      board,
      "wchodzi",
    );

    expect(named(predecessors)).toEqual(["odchodzi-a", "odchodzi-b"]);
    expect(predecessors.map((c) => c.gapDays)).toEqual([0, 0]);
    expect(predecessors.map((c) => c.batchSize)).toEqual([2, 2]);
    // Still in post, so nobody has taken the seat off them yet.
    expect(successors).toEqual([]);

    expect(successionsAtCompany(board)).toHaveLength(2);
  });

  it("hands back the whole batch Związek Miast Polskich filed in one day", () => {
    // The shape this feature exists for, from the register: six members of the
    // Zarząd struck off on 4 June 2003, Ryszard Grobelny entered the same day,
    // and twelve years later four people entered on the day he left. The
    // greedy rule picks one name out of each batch; here all of them stand.
    const zmp = [
      ...[
        "zabieglinski",
        "barzowski",
        "jedlinski",
        "uszok",
        "rozpara",
        "kaczmarek",
      ].map((id) => spell(id, "2001-12-06", "2003-06-04", "Zarząd")),
      spell("grobelny", "2003-06-04", "2015-06-01", "Zarząd"),
      ...["karakula", "pluta", "choma", "szynkowski"].map((id) =>
        spell(id, "2015-06-01", null, "Zarząd"),
      ),
    ];

    const { posts, predecessors, successors } = successionCandidatesForPerson(
      zmp,
      "grobelny",
    );

    expect(posts.map((post) => post.personId)).toEqual(["grobelny"]);
    // Sorted on the register's own facts and then the node id - never on the
    // edge ids, because every gap here is zero and the tie-break is the whole
    // of the order.
    expect(named(predecessors)).toEqual([
      "barzowski",
      "jedlinski",
      "kaczmarek",
      "rozpara",
      "uszok",
      "zabieglinski",
    ]);
    expect(predecessors.every((c) => c.gapDays === 0)).toBe(true);
    expect(predecessors.every((c) => c.batchSize === 6)).toBe(true);
    expect(named(successors)).toEqual([
      "choma",
      "karakula",
      "pluta",
      "szynkowski",
    ]);
    expect(successors.every((c) => c.batchSize === 4)).toBe(true);
  });

  it("keeps the same window as the greedy rule, either side of it", () => {
    const focus = spell("grobelny", "2004-04-13", "2016-08-16");
    const candidates = (day: string) =>
      named(
        successionCandidatesForPerson(
          [focus, spell("inny", day, null)],
          "grobelny",
        ).successors,
      );

    // Międzynarodowe Targi Poznańskie: the one successor the register allows
    // him, entered three weeks after he was struck off.
    const lewandowski = successionCandidatesForPerson(
      [focus, spell("lewandowski", plus("2016-08-16", 23), null)],
      "grobelny",
    );
    expect(named(lewandowski.successors)).toEqual(["lewandowski"]);
    expect(lewandowski.successors[0]!.gapDays).toBe(23);

    expect(candidates(plus("2016-08-16", MAX_GAP_DAYS))).toEqual(["inny"]);
    expect(candidates(plus("2016-08-16", MAX_GAP_DAYS + 1))).toEqual([]);
    expect(candidates(plus("2016-08-16", -MAX_OVERLAP_DAYS))).toEqual(["inny"]);
    expect(candidates(plus("2016-08-16", -MAX_OVERLAP_DAYS - 1))).toEqual([]);
  });

  it("returns a post whose role nobody recorded, with nobody either side", () => {
    // "We found nobody" and "we cannot look" are different facts, and a page
    // that drops the second tells a reader the post does not exist.
    const spells = [
      spell("grobelny", "2010-01-01", "2020-01-01", null),
      spell("ktos-inny", "2020-01-01", null, null),
      spell("grobelny", "2005-01-01", "2009-01-01", "Zarząd"),
      spell("nastepca", "2009-01-01", null, "Zarząd"),
    ];

    const { posts, predecessors, successors } = successionCandidatesForPerson(
      spells,
      "grobelny",
    );

    expect(posts.map((post) => post.role)).toEqual([null, "Zarząd"]);
    expect(predecessors).toEqual([]);
    // Two unrecorded roles at one company are not evidence of one seat, so the
    // only candidate is the one in the seat the register did name.
    expect(named(successors)).toEqual(["nastepca"]);
  });

  it("does not let somebody succeed themselves", () => {
    const { posts, predecessors, successors } = successionCandidatesForPerson(
      [
        spell("grobelny", "2016-01-01", "2020-04-12"),
        spell("grobelny", "2020-04-12", null),
      ],
      "grobelny",
    );

    expect(posts).toHaveLength(2);
    expect(predecessors).toEqual([]);
    expect(successors).toEqual([]);
  });

  it("counts the same filing recorded twice as one post and one candidate", () => {
    const own = spell("grobelny", "2003-06-04", "2015-06-01", "Zarząd");
    const leaver = spell("rozpara", "2001-12-06", "2003-06-04", "Zarząd");

    const { posts, predecessors } = successionCandidatesForPerson(
      [
        own,
        { ...own, id: "kopia-wlasna" },
        leaver,
        { ...leaver, id: "kopia-cudza" },
      ],
      "grobelny",
    );

    expect(posts).toHaveLength(1);
    expect(named(predecessors)).toEqual(["rozpara"]);
    expect(predecessors[0]!.batchSize).toBe(1);
  });

  it("points every candidacy at a post that is in the list", () => {
    // The trap behind this one: `seatGroups` fingerprints a spell on (person,
    // role, start) with no end date and keeps whichever copy Firestore handed
    // back first - 200 duplicate fingerprints in the register, 170 of them
    // disagreeing about `end_date`. A caller that took the focus person's own
    // spell from somewhere else and then looked it up by edge id would find
    // the copy that lost, and report nothing for a perfectly real edge. So the
    // posts and the candidacies are cut from the same list, and `own` is an
    // object out of `posts` rather than an id to resolve.
    const first = {
      id: "edge-pierwszy",
      personId: "grobelny",
      role: "Zarząd",
      start: "2003-06-04",
      end: "2015-06-01",
    } as SuccessionSpell;
    const second: SuccessionSpell = {
      ...first,
      id: "edge-odrzucony",
      end: "2015-06-02",
    };

    const { posts, predecessors } = successionCandidatesForPerson(
      [first, second, spell("rozpara", "2001-12-06", "2003-06-04", "Zarząd")],
      "grobelny",
    );

    expect(posts).toHaveLength(1);
    expect(posts[0]!.id).toBe("edge-pierwszy");
    expect(predecessors).toHaveLength(1);
    expect(posts).toContain(predecessors[0]!.own);
  });

  it("names the same person on both sides when the register does", () => {
    // Left the seat just before this person took it and came back to it just
    // after they left. Two different filings, both real, and a chain that
    // refused the second would be hiding the more interesting one.
    const { predecessors, successors } = successionCandidatesForPerson(
      [
        spell("wraca", "2005-01-01", "2010-01-01"),
        spell("grobelny", "2010-01-01", "2015-01-01"),
        spell("wraca", "2015-01-01", null),
      ],
      "grobelny",
    );

    expect(named(predecessors)).toEqual(["wraca"]);
    expect(named(successors)).toEqual(["wraca"]);
  });

  it("does not depend on the order the edges came back in", () => {
    const spells = [
      spell("odchodzi-a", "2018-01-01", "2024-04-12"),
      spell("odchodzi-b", "2019-01-01", "2024-04-12"),
      spell("grobelny", "2024-04-12", "2025-01-01"),
      spell("wchodzi", "2025-01-01", null),
    ];

    const forwards = successionCandidatesForPerson(spells, "grobelny");
    const backwards = successionCandidatesForPerson(
      [...spells].reverse(),
      "grobelny",
    );

    expect(named(backwards.predecessors)).toEqual(named(forwards.predecessors));
    expect(named(backwards.successors)).toEqual(named(forwards.successors));
    expect(backwards.posts.map((post) => post.id)).toEqual(
      forwards.posts.map((post) => post.id),
    );
  });

  it("abandons a seat group too large to be a board", () => {
    // Without the one-to-one cap the match is quadratic in the size of a
    // group, and the same backstop the greedy rule uses is what keeps a data
    // error from turning into tens of thousands of links. It has never fired
    // on real data - the largest group in the register is 42.
    // One short of the cap, plus the person the page is about, is exactly the
    // cap and still answered.
    const crowd = Array.from({ length: MAX_SEAT_GROUP - 1 }, (_, i) =>
      spell(`odchodzi${i}`, "2018-01-01", "2024-04-12"),
    );
    const focus = spell("grobelny", "2024-04-12", null);

    expect(
      successionCandidatesForPerson([...crowd, focus], "grobelny").predecessors,
    ).toHaveLength(MAX_SEAT_GROUP - 1);
    expect(
      successionCandidatesForPerson(
        [
          ...crowd,
          spell("odchodzi-nadmiarowy", "2018-01-01", "2024-04-12"),
          focus,
        ],
        "grobelny",
      ).predecessors,
    ).toEqual([]);
  });
});

describe("gapLabel", () => {
  it("says what kind of gap it is, not how big the number is", () => {
    expect(gapLabel(0)).toBe("tego samego dnia");
    expect(gapLabel(1)).toBe("po 1 dniu przerwy");
    expect(gapLabel(38)).toBe("po 38 dniach przerwy");
    expect(gapLabel(-1)).toBe("wpisy nachodzą na siebie o 1 dzień");
    expect(gapLabel(-23)).toBe("wpisy nachodzą na siebie o 23 dni");
  });
});
