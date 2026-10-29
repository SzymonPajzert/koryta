import { describe, it, expect } from "vitest";
import {
  compareDeclarationDates,
  declarationConfidenceLabel,
  declarationDateText,
  declarationDifferenceLabels,
  declarationDifferenceTone,
  declarationDrainText,
  declarationHoldLabels,
  declarationHoldNote,
  declarationHoldNotes,
  declarationHoldTone,
  declarationPeopleAccusative,
  declarationQueueDays,
  declarationReasonLabel,
  declarationSettledByLabels,
  declarationStages,
  declarationStatusLabels,
  groupDeclarationRuns,
} from "~/utils/declarationsAdmin";
import {
  extractStatuses,
  publicationHoldReasons,
  settledBy,
  type DeclarationOverview,
  type DrainResult,
} from "~~/shared/declarations";

/** An overview with nothing in it but the counts a test sets. */
function overview(
  over: {
    candidacies?: Partial<DeclarationOverview["candidacies"]>;
    extracts?: Omit<Partial<DeclarationOverview["extracts"]>, "byStatus"> & {
      byStatus?: Partial<DeclarationOverview["extracts"]["byStatus"]>;
    };
    pages?: Partial<DeclarationOverview["pages"]>;
    publications?: Partial<DeclarationOverview["publications"]>;
  } = {},
): DeclarationOverview {
  return {
    at: "2026-10-29T12:55:00.000Z",
    dailyLimit: 10,
    candidacies: {
      total: 0,
      people: 0,
      byStatus: { pending: 0, found: 0, unconfirmed: 0, not_found: 0 },
      notFound: [],
      ...over.candidacies,
    },
    extracts: {
      total: 0,
      failed: [],
      ...over.extracts,
      byStatus: {
        open: 0,
        agreed: 0,
        unreadable: 0,
        disputed: 0,
        failed: 0,
        withdrawn: 0,
        ...over.extracts?.byStatus,
      },
    },
    readers: { answers: 0, readers: 0, days: [] },
    pages: { same: 0, different: 0, noDate: 0, confirmed: 0, ...over.pages },
    publications: {
      queued: 0,
      published: 0,
      held: 0,
      today: 0,
      heldBy: [],
      ...over.publications,
    },
    lists: { disputed: [], different: [], held: [], recent: [] },
    runs: [],
  };
}

/** The characters a comparison marks, as one string. */
const marked = (chars: { char: string; differs: boolean }[]) =>
  chars
    .filter((c) => c.differs)
    .map((c) => c.char)
    .join("");

describe("the words for the job's codes", () => {
  it("names every reason a publication is held, and says what clears it", () => {
    for (const reason of publicationHoldReasons) {
      expect(declarationHoldLabels[reason], reason).toMatch(/\S/);
      expect(declarationHoldNotes[reason], reason).toMatch(/\S/);
    }
    // Nothing left over from a reason the server no longer sends.
    expect(Object.keys(declarationHoldLabels).sort()).toEqual(
      [...publicationHoldReasons].sort(),
    );
    expect(Object.keys(declarationHoldNotes).sort()).toEqual(
      [...publicationHoldReasons].sort(),
    );
  });

  it("says a date an admin settled is the admin's, to publish by hand", () => {
    expect(declarationHoldLabels.admin_decision).toBe(
      "datę ustalił administrator",
    );
    expect(declarationHoldNotes.admin_decision).toBe(
      "Opublikuj ręcznie ze strony osoby, jeśli się zgadza.",
    );
    expect(declarationHoldNote("admin_decision", false)).toBe(
      "Opublikuj ręcznie ze strony osoby, jeśli się zgadza.",
    );
  });

  it("asks nobody to publish a page an admin's date held that is public by now", () => {
    // Published by hand while it waited: a hold is never cleared.
    expect(declarationHoldNote("admin_decision", true)).toBe(
      "Strona jest już publiczna. Oświadczenia na niej nie podpięto, bo datę ustalił administrator.",
    );
    // The other reasons keep their own words.
    for (const reason of publicationHoldReasons) {
      if (reason === "admin_decision") continue;
      expect(declarationHoldNote(reason, true), reason).toBe(
        declarationHoldNotes[reason],
      );
    }
  });

  it("names every state a crop can be in", () => {
    for (const status of extractStatuses) {
      expect(declarationStatusLabels[status], status).toMatch(/\S/);
    }
    expect(Object.keys(declarationStatusLabels).sort()).toEqual(
      [...extractStatuses].sort(),
    );
  });

  it("puts somebody's decision in blue and a doubt in amber", () => {
    const decisions: readonly string[] = [
      "kept_hidden",
      "pending_proposal",
      "revision_rejected",
      "candidacy_reviewed",
    ];
    for (const reason of publicationHoldReasons) {
      if (reason === "admin_decision") continue;
      for (const pagePublic of [false, true]) {
        expect(declarationHoldTone(reason, pagePublic), reason).toBe(
          decisions.includes(reason) ? "info" : "warning",
        );
      }
    }
    expect(declarationHoldTone(null)).toBe("warning");
  });

  it("puts an admin's date in amber on a draft, which waits for a check, and in blue on a public page", () => {
    // The section's legend: „Niebieskie to cudza decyzja, bursztynowe
    // czekają na wyjaśnienie.” A draft asks to be checked and published.
    expect(declarationHoldTone("admin_decision")).toBe("warning");
    expect(declarationHoldTone("admin_decision", false)).toBe("warning");
    expect(declarationHoldTone("admin_decision", true)).toBe("info");
  });

  it("names whoever can settle a crop's date", () => {
    for (const by of settledBy) {
      expect(declarationSettledByLabels[by], by).toMatch(/\S/);
    }
    expect(Object.keys(declarationSettledByLabels).sort()).toEqual(
      [...settledBy].sort(),
    );
  });

  it("shows a reason nobody has named yet as its code", () => {
    expect(declarationReasonLabel("no_seed")).toBe("brak adresu BIP urzędu");
    expect(declarationReasonLabel("blank_form")).toBe(
      "pusty formularz do pobrania",
    );
    expect(declarationReasonLabel("rotated_scan_v2")).toBe("rotated_scan_v2");
  });

  it("says the machine's confidence in words, and nothing for an unknown one", () => {
    expect(declarationConfidenceLabel("high")).toBe("wysoka pewność");
    expect(declarationConfidenceLabel("medium")).toBe("średnia pewność");
    expect(declarationConfidenceLabel("low")).toBe("niska pewność");
    expect(declarationConfidenceLabel(null)).toBeNull();
    expect(declarationConfidenceLabel("certain")).toBeNull();
  });
});

describe("declarationDateText", () => {
  it("prints a date as the page does, a year alone as a year", () => {
    expect(declarationDateText("1979-07-15")).toBe("15.07.1979");
    expect(declarationDateText("1979")).toBe("1979");
    expect(declarationDateText(null)).toBe("brak");
    expect(declarationDateText("")).toBe("brak");
  });
});

describe("compareDeclarationDates", () => {
  it("has nothing to compare against a page without a date", () => {
    expect(compareDeclarationDates("1979-07-15", null)).toBeNull();
  });

  it("marks nothing when the dates agree", () => {
    const result = compareDeclarationDates("1979-07-15", "1979-07-15")!;
    expect(result.kind).toBe("same");
    expect(marked(result.reading)).toBe("");
    expect(marked(result.stored)).toBe("");
    expect(result.reading.map((c) => c.char).join("")).toBe("15.07.1979");
  });

  it("calls one character off a digit, and marks it on both sides", () => {
    const result = compareDeclarationDates("1979-07-16", "1979-07-15")!;
    expect(result.kind).toBe("digit");
    expect(marked(result.reading)).toBe("6");
    expect(marked(result.stored)).toBe("5");
    // A year one digit off is still one digit: likelier a misread 6 than
    // somebody else's declaration.
    expect(compareDeclarationDates("1969-07-15", "1979-07-15")!.kind).toBe(
      "digit",
    );
  });

  it("tells a day and a month swapped from another day", () => {
    const swapped = compareDeclarationDates("1979-07-05", "1979-05-07")!;
    expect(swapped.kind).toBe("swap");
    expect(marked(swapped.reading)).toBe("57");
    expect(marked(swapped.stored)).toBe("75");

    expect(compareDeclarationDates("1979-07-15", "1979-08-26")!.kind).toBe(
      "day",
    );
  });

  it("calls another year a year, the likeliest sign of another person", () => {
    const result = compareDeclarationDates("1981-07-15", "1979-07-15")!;
    expect(result.kind).toBe("year");
    expect(marked(result.reading)).toBe("81");
    expect(marked(result.stored)).toBe("79");
  });

  it("compares a year alone with the page's year only", () => {
    const same = compareDeclarationDates("1979", "1979-07-15")!;
    expect(same.kind).toBe("same");
    // The page's day and month are printed, never marked.
    expect(same.stored.map((c) => c.char).join("")).toBe("15.07.1979");
    expect(marked(same.stored)).toBe("");

    const digit = compareDeclarationDates("1978", "1979-07-15")!;
    expect(digit.kind).toBe("digit");
    expect(marked(digit.reading)).toBe("8");
    expect(marked(digit.stored)).toBe("9");

    expect(compareDeclarationDates("1968", "1979-07-15")!.kind).toBe("year");
  });

  it("has a word and a colour for every kind", () => {
    expect(Object.keys(declarationDifferenceLabels).sort()).toEqual(
      ["day", "digit", "same", "swap", "year"].sort(),
    );
    expect(declarationDifferenceTone("same")).toBe("success");
    expect(declarationDifferenceTone("year")).toBe("danger");
    for (const kind of ["digit", "swap", "day"] as const) {
      expect(declarationDifferenceTone(kind), kind).toBe("warning");
    }
  });
});

describe("declarationStages", () => {
  it("counts each stage in its own unit", () => {
    // The production-shaped overview of the design round (2026-10-29).
    const stages = declarationStages(
      overview({
        candidacies: {
          total: 3368,
          byStatus: {
            pending: 412,
            found: 1212,
            unconfirmed: 187,
            not_found: 1557,
          },
        },
        extracts: {
          total: 1070,
          byStatus: {
            open: 572,
            agreed: 320,
            unreadable: 11,
            disputed: 14,
            failed: 151,
            withdrawn: 2,
          },
        },
        pages: { same: 94, different: 20, noDate: 178, confirmed: 22 },
        publications: { published: 74, queued: 9, held: 11 },
      }),
    );
    expect(stages).toEqual({
      candidacies: 3368,
      found: 1212,
      declarations: 1070,
      crops: 1070 - 151 - 2,
      agreed: 320,
      compared: 94 + 20 + 178 + 22,
      same: 94,
      decided: 74 + 9 + 11,
      published: 74,
    });
  });

  it("never shows fewer than no crops when the parts outrun the whole", () => {
    // Counted a moment apart: an upload between the counts can leave more
    // failed and withdrawn crops than declarations.
    const stages = declarationStages(
      overview({
        extracts: { total: 3, byStatus: { failed: 4, withdrawn: 1 } },
      }),
    );
    expect(stages.crops).toBe(0);
    expect(declarationStages(overview()).crops).toBe(0);
  });
});

describe("declarationQueueDays", () => {
  it("says how many days the queue takes at the limit", () => {
    expect(declarationQueueDays(0, 10)).toBe(0);
    expect(declarationQueueDays(9, 10)).toBe(1);
    expect(declarationQueueDays(10, 10)).toBe(1);
    expect(declarationQueueDays(83, 10)).toBe(9);
  });

  it("has no answer when nothing publishes on its own", () => {
    expect(declarationQueueDays(83, 0)).toBeNull();
    expect(declarationQueueDays(83, -1)).toBeNull();
  });
});

describe("groupDeclarationRuns", () => {
  it("shows a run once, its uploads summed, newest first", () => {
    const groups = groupDeclarationRuns([
      {
        tag: "bip-cut-v1",
        runId: "20261029T040000Z",
        extracts: 25,
        at: "2026-10-29T04:31:00.000Z",
      },
      {
        tag: "bip-cut-v1",
        runId: "20261018T120000Z",
        extracts: 1011,
        at: "2026-10-18T12:46:00.000Z",
      },
      {
        tag: "bip-cut-v1",
        runId: "20261029T040000Z",
        extracts: 17,
        at: "2026-10-29T04:12:00.000Z",
      },
    ]);
    expect(groups).toEqual([
      {
        key: "bip-cut-v1|20261029T040000Z",
        tag: "bip-cut-v1",
        runId: "20261029T040000Z",
        uploads: 2,
        extracts: 42,
        first: "2026-10-29T04:12:00.000Z",
        last: "2026-10-29T04:31:00.000Z",
      },
      {
        key: "bip-cut-v1|20261018T120000Z",
        tag: "bip-cut-v1",
        runId: "20261018T120000Z",
        uploads: 1,
        extracts: 1011,
        first: "2026-10-18T12:46:00.000Z",
        last: "2026-10-18T12:46:00.000Z",
      },
    ]);
  });

  it("groups uploads without a run id by tag and Warsaw day", () => {
    const groups = groupDeclarationRuns([
      // 00:30 in Warsaw on the 29th, though still the 28th in UTC.
      { tag: "v1", runId: null, extracts: 3, at: "2026-10-28T23:30:00.000Z" },
      { tag: "v1", runId: null, extracts: 4, at: "2026-10-29T09:00:00.000Z" },
      { tag: "v2", runId: null, extracts: 5, at: "2026-10-29T10:00:00.000Z" },
      { tag: "v1", runId: null, extracts: 6, at: "2026-10-28T09:00:00.000Z" },
    ]);
    expect(groups.map((g) => [g.key, g.uploads, g.extracts])).toEqual([
      ["v2|2026-10-29", 1, 5],
      ["v1|2026-10-29", 2, 7],
      ["v1|2026-10-28", 1, 6],
    ]);
  });
});

describe("declarationPeopleAccusative", () => {
  it("counts people the way „opublikować” takes them", () => {
    expect([1, 2, 5, 12, 22, 104].map(declarationPeopleAccusative)).toEqual([
      "jedną osobę",
      "2 osoby",
      "5 osób",
      "12 osób",
      "22 osoby",
      "104 osoby",
    ]);
  });
});

describe("declarationDrainText", () => {
  /** A press, as publish-queued answers it: past the limit, with what is
   * left in the queue counted. */
  const pass = (over: Partial<DrainResult> = {}): DrainResult => ({
    day: "2026-10-29",
    limit: 10,
    skipped: null,
    published: [],
    held: [],
    confirmed: [],
    failed: [],
    capReached: false,
    waiting: 0,
    ...over,
  });

  it("says how many went up, and how many still wait", () => {
    expect(declarationDrainText(pass({ published: ["a"] }))).toBe(
      "Opublikowano z kolejki jedną osobę. W kolejce nikt już nie czeka.",
    );
    expect(
      declarationDrainText(pass({ published: ["a", "b"], waiting: 58 })),
    ).toBe("Opublikowano z kolejki 2 osoby. W kolejce czeka jeszcze 58 osób.");
  });

  it("counts who still waits the way Polish counts people", () => {
    const left = (waiting: number) =>
      declarationDrainText(pass({ published: ["a"], waiting })).replace(
        "Opublikowano z kolejki jedną osobę. ",
        "",
      );
    expect([1, 2, 5, 12, 22, 104].map(left)).toEqual([
      "W kolejce czeka jeszcze jedna osoba.",
      "W kolejce czekają jeszcze 2 osoby.",
      "W kolejce czeka jeszcze 5 osób.",
      "W kolejce czeka jeszcze 12 osób.",
      "W kolejce czekają jeszcze 22 osoby.",
      "W kolejce czekają jeszcze 104 osoby.",
    ]);
  });

  it("says why nobody did: the night window or a people import, never the limit", () => {
    expect(declarationDrainText(pass({ skipped: "night", waiting: 83 }))).toBe(
      "Nikogo nie opublikowano: od 3:00 do 9:00 trwa nocny import osób, który mógłby cofnąć publikację. W kolejce czekają jeszcze 83 osoby.",
    );
    expect(declarationDrainText(pass({ skipped: "import", waiting: 9 }))).toBe(
      "Nikogo nie opublikowano: trwa import osób albo nie da się sprawdzić, czy trwa. W kolejce czeka jeszcze 9 osób.",
    );
    expect(declarationDrainText(pass())).toBe(
      "Nikogo nie opublikowano. W kolejce nikt już nie czeka.",
    );
  });

  it("adds who was held and what did not finish", () => {
    expect(
      declarationDrainText(
        pass({
          published: ["a"],
          held: [
            { personId: "b", reason: "pending_proposal" },
            { personId: "c", reason: "two_pages" },
          ],
          failed: ["d"],
          waiting: 1,
        }),
      ),
    ).toBe(
      "Opublikowano z kolejki jedną osobę. Wstrzymano 2 osoby; powody są na liście „Wstrzymane publikacje”. Części publikacji nie udało się dokończyć: poczekają na kolejną próbę. W kolejce czeka jeszcze jedna osoba.",
    );
  });

  it("says nothing of the queue for a pass that did not count it", () => {
    expect(
      declarationDrainText(pass({ published: ["a"], waiting: null })),
    ).toBe("Opublikowano z kolejki jedną osobę.");
  });
});
