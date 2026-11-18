import { describe, it, expect } from "vitest";
import {
  compareDeclarationDates,
  declarationConfidenceLabel,
  declarationDateText,
  declarationDifferenceLabels,
  declarationDifferenceTone,
  declarationDrainText,
  declarationHoldActions,
  declarationRecheckLabel,
  declarationHoldLabel,
  declarationHoldLabels,
  declarationHoldNote,
  declarationHoldNotes,
  declarationHoldTone,
  declarationPeopleAccusative,
  declarationQueueDays,
  declarationReasonLabel,
  declarationRecheckText,
  declarationSettledByLabels,
  declarationStages,
  declarationStatusLabels,
  groupDeclarationRuns,
} from "~/utils/declarationsAdmin";
import {
  extractStatuses,
  publicationHoldReasons,
  publicationSetAside,
  settledBy,
  type DeclarationOverview,
  type DeclarationPublicationRow,
  type DrainResult,
  type PublicationHoldReason,
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
      setAside: 0,
      today: 0,
      heldBy: [],
      ...over.publications,
    },
    lists: { disputed: [], different: [], held: [], setAside: [], recent: [] },
    runs: [],
  };
}

/** A draft with a paid post on it, held for `reason`. */
function heldRow(
  reason: PublicationHoldReason | null,
  over: Partial<DeclarationPublicationRow> = {},
): DeclarationPublicationRow {
  return {
    personId: "kowalska",
    name: "Anna Kowalska",
    status: "held",
    reason,
    pagePublic: false,
    paidPost: true,
    at: "2026-10-29T12:00:00.000Z",
    unit: "Strzelin",
    documentUrl: "https://bip.example.pl/1",
    edges: { published: 0, held: 0 },
    pressed: false,
    ...over,
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
    // Published by hand, the page shows no declaration: it says so first.
    const note =
      "Opublikuj ręcznie, jeśli się zgadza. Datę ustalił administrator, więc oświadczenia na stronie nie będzie.";
    expect(declarationHoldNotes.admin_decision).toBe(note);
    expect(declarationHoldNote(heldRow("admin_decision"))).toBe(note);
  });

  it("asks nobody to publish a page that is public by now", () => {
    // From before a publication by hand closed the hold.
    for (const reason of publicationHoldReasons) {
      if (reason === "two_pages") continue;
      const row = heldRow(reason, { pagePublic: true });
      expect(declarationHoldNote(row), reason).toBe(
        "Strona jest już publiczna.",
      );
      expect(declarationHoldLabel(row), reason).toBe("strona już publiczna");
    }
  });

  it("still asks about two pages with one date, one of them public", () => {
    const row = heldRow("two_pages", { pagePublic: true });

    expect(declarationHoldNote(row)).toBe(declarationHoldNotes.two_pages);
    expect(declarationHoldLabel(row)).toBe(declarationHoldLabels.two_pages);
  });

  it("says why a page will not be published, whatever it was held for", () => {
    for (const reason of ["two_places", "no_public_post"] as const) {
      const row = heldRow(reason, { paidPost: false });

      expect(declarationHoldLabel(row), reason).toBe(
        "brak płatnego stanowiska",
      );
      expect(declarationHoldNote(row), reason).toBe(
        declarationHoldNotes.no_public_post,
      );
    }
  });

  it("says a page held for having no post has one now", () => {
    const row = heldRow("no_public_post");

    expect(declarationHoldLabel(row)).toBe("jest już płatne stanowisko");
    // A recheck would publish the page without a post added by hand.
    expect(declarationHoldNote(row)).toBe(
      "Na stronie jest już płatne stanowisko. Opublikuj ręcznie i zaznacz je.",
    );
    expect(declarationHoldActions(row)).toEqual({
      publish: true,
      recheck: false,
      decline: true,
      restore: false,
    });
  });

  it("tells the admin what clears each hold that waits", () => {
    expect(declarationHoldNote(heldRow("two_pages"))).toBe(
      "Ta osoba ma dwie strony. Połącz je albo opublikuj właściwą ręcznie.",
    );
    expect(declarationHoldNote(heldRow("ambiguous_candidacy"))).toBe(
      "W powiecie z oświadczenia pasują dwie kandydatury tej osoby. Przy publikacji ręcznej zaznacz tylko właściwą.",
    );
    expect(declarationHoldNote(heldRow("two_places"))).toBe(
      "Kandydatury wypadają w dwóch miejscach naraz. Przy publikacji ręcznej zaznacz tylko właściwą.",
    );
    expect(declarationHoldNote(heldRow("conflicting_reading"))).toBe(
      "Inny wycinek tej osoby podaje inną datę. Popraw jego odczyt albo wycofaj go, jeśli nie jest jej, i sprawdź ponownie.",
    );
    expect(declarationHoldNote(heldRow("needs_split"))).toBe(
      "Strona jest do rozdzielenia. Rozdziel ją, potem sprawdź ponownie.",
    );
    expect(declarationHoldNote(heldRow("kept_hidden"))).toBe(
      "Administrator zostawił tę stronę ukrytą. Wyjdzie tylko opublikowana ręcznie.",
    );
  });

  it("sends the admin to publish before the proposal, which can erase the date", () => {
    // Not „the import's version”: where a person's proposal is the newest,
    // publishing approves that one, and the dialog says so.
    expect(declarationHoldNote(heldRow("pending_proposal"))).toBe(
      "Na stronie czeka propozycja zmiany. Opublikuj ręcznie, a propozycję rozpatrz potem.",
    );
  });

  it("says an admin decided, and what the page was held for", () => {
    const row = heldRow("two_places", { status: "declined" });

    expect(declarationHoldLabel(row)).toBe("decyzja administratora");
    expect(declarationHoldNote(row)).toBe(
      "Odłożona przez administratora. Była wstrzymana: kandydatura w dwóch miejscach naraz.",
    );
    expect(declarationHoldNote({ ...row, reason: null })).toBe(
      "Odłożona przez administratora.",
    );
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
      expect(declarationHoldTone(reason), reason).toBe(
        decisions.includes(reason) ? "info" : "warning",
      );
    }
    expect(declarationHoldTone(null)).toBe("warning");
  });

  it("puts any hold on a public page in blue, where it asks nothing, but two pages", () => {
    for (const reason of publicationHoldReasons) {
      expect(declarationHoldTone(reason, true), reason).toBe(
        reason === "two_pages" ? "warning" : "info",
      );
    }
  });

  it("puts an admin's date in amber on a draft, which waits for a check, and in blue on a public page", () => {
    // The section's legend: „Niebieskie to cudza decyzja, bursztynowe
    // czekają na wyjaśnienie.” A draft asks to be checked and published.
    expect(declarationHoldTone("admin_decision")).toBe("warning");
    expect(declarationHoldTone("admin_decision", false)).toBe("warning");
    expect(declarationHoldTone("admin_decision", true)).toBe("info");
  });

  describe("declarationHoldActions", () => {
    it("offers a page that waits all three ways out", () => {
      expect(declarationHoldActions(heldRow("two_places"))).toEqual({
        publish: true,
        recheck: true,
        decline: true,
        restore: false,
      });
    });

    it("does not offer to check a draft only an admin's date holds", () => {
      expect(declarationHoldActions(heldRow("admin_decision"))).toEqual({
        publish: true,
        recheck: false,
        decline: true,
        restore: false,
      });
    });

    it("offers only a publication by hand on a page with no paid post", () => {
      // Its post may be one the pipelines have not recorded, a mayor's office.
      for (const reason of ["no_public_post", "two_places"] as const) {
        expect(
          declarationHoldActions(heldRow(reason, { paidPost: false })),
          reason,
        ).toEqual({
          publish: true,
          recheck: false,
          decline: false,
          restore: false,
        });
      }
    });

    it("does not offer a check that no admin's action lets pass", () => {
      for (const reason of [
        "kept_hidden",
        "pending_proposal",
        "revision_rejected",
        "name_differs",
      ] as const) {
        expect(declarationHoldActions(heldRow(reason)), reason).toEqual({
          publish: true,
          recheck: false,
          decline: true,
          restore: false,
        });
      }
      for (const reason of [
        "candidacy_reviewed",
        "no_revision",
        "no_longer_matches",
        "conflicting_reading",
        "no_candidacy_on_page",
      ] as const) {
        expect(declarationHoldActions(heldRow(reason)).recheck, reason).toBe(
          true,
        );
      }
    });

    it("offers only to close the hold of a page that is public", () => {
      for (const reason of ["two_places", "admin_decision"] as const) {
        expect(
          declarationHoldActions(heldRow(reason, { pagePublic: true })),
          reason,
        ).toEqual({
          publish: false,
          recheck: true,
          decline: false,
          restore: false,
        });
        expect(
          declarationRecheckLabel(heldRow(reason, { pagePublic: true })),
        ).toBe("Zamknij wstrzymanie");
      }
      // Two pages with one date are asked again, not closed, and can be set
      // aside: the other page may keep its date for good.
      expect(
        declarationRecheckLabel(heldRow("two_pages", { pagePublic: true })),
      ).toBe("Sprawdź ponownie");
      expect(
        declarationHoldActions(heldRow("two_pages", { pagePublic: true })),
      ).toEqual({
        publish: false,
        recheck: true,
        decline: true,
        restore: false,
      });
    });

    it("offers to take an admin's no back, and nothing else", () => {
      expect(
        declarationHoldActions(heldRow("two_places", { status: "declined" })),
      ).toEqual({
        publish: false,
        recheck: false,
        decline: false,
        restore: true,
      });
    });

    it("offers nothing on a row that is not held", () => {
      expect(
        declarationHoldActions(heldRow(null, { status: "published" })),
      ).toEqual({
        publish: false,
        recheck: false,
        decline: false,
        restore: false,
      });
    });
  });

  describe("publicationSetAside", () => {
    it("is who an admin declined, and a draft with no paid post", () => {
      expect(publicationSetAside(heldRow("two_places"))).toBe(false);
      expect(
        publicationSetAside(heldRow("two_places", { paidPost: false })),
      ).toBe(true);
      expect(
        publicationSetAside(heldRow("two_places", { status: "declined" })),
      ).toBe(true);
    });

    it("leaves a public page with its hold to close", () => {
      expect(
        publicationSetAside(
          heldRow("two_places", { paidPost: false, pagePublic: true }),
        ),
      ).toBe(false);
    });

    it("asks nothing of a row whose post nobody looked for", () => {
      expect(
        publicationSetAside(
          heldRow(null, { status: "published", paidPost: undefined }),
        ),
      ).toBe(false);
    });
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
        publications: { published: 74, queued: 9, held: 11, setAside: 6 },
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
      decided: 74 + 9 + 11 + 6,
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

describe("declarationRecheckText", () => {
  it("says what came of asking a page again", () => {
    expect(declarationRecheckText({ outcome: "published" })).toBe(
      "Opublikowano.",
    );
    expect(declarationRecheckText({ outcome: "confirmed" })).toBe(
      "Strona była już publiczna. Wstrzymanie zamknięte.",
    );
  });

  it("names what holds a page now, which may not be what held it", () => {
    expect(
      declarationRecheckText({ outcome: "held", reason: "two_places" }),
    ).toBe("Nadal wstrzymana: kandydatura w dwóch miejscach naraz.");
  });

  it("says why nobody looked, in the words of the queue", () => {
    expect(
      declarationRecheckText({ outcome: "skipped", skipped: "night" }),
    ).toBe(
      "Nie sprawdzono: od 3:00 do 9:00 trwa nocny import osób, który mógłby cofnąć publikację.",
    );
    expect(
      declarationRecheckText({ outcome: "skipped", skipped: "import" }),
    ).toBe(
      "Nie sprawdzono: trwa import osób albo nie da się sprawdzić, czy trwa.",
    );
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
      "Opublikowano z kolejki jedną osobę. Wstrzymano 2 osoby; powody są na listach „Wstrzymane publikacje” i „Nie do publikacji”. Części publikacji nie udało się dokończyć: poczekają na kolejną próbę. W kolejce czeka jeszcze jedna osoba.",
    );
  });

  it("says nothing of the queue for a pass that did not count it", () => {
    expect(
      declarationDrainText(pass({ published: ["a"], waiting: null })),
    ).toBe("Opublikowano z kolejki jedną osobę.");
  });
});
