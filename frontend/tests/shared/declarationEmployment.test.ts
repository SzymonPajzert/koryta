import { describe, it, expect } from "vitest";
import {
  DECLARED_INCOME_SHOWN,
  declaredKey,
  employerKey,
  employerLookup,
  employmentAnswerId,
  employmentAnswerSchema,
  employmentImagesId,
  employmentIngestSchema,
  employmentItemSchema,
  employmentPriority,
  familyKind,
  institutionKinds,
  isBoardFamily,
  looksLikeAddress,
  roleChips,
  roleFamilyOf,
  rolesFor,
  rowKey,
  seatRoles,
  settleEmployment,
  type EmployerRef,
  type EmploymentVote,
} from "../../shared/declarationEmployment";

/** Synthetic REGONs with their check digits: a starostwo, a company and a
 * local unit of the first. */
const REGON_A = "123456785";
const REGON_B = "987654326";
const REGON_LOCAL = "12345678500002";

const STAROSTWO: EmployerRef = { regon: REGON_A };
const COMPANY: EmployerRef = { place: "fxCompany0001" };

type Row = NonNullable<EmploymentVote["rows"]>[number];

const row = (
  employer: EmployerRef,
  role: string,
  extra: Partial<Row> = {},
): Row => ({ employer, role, ...extra });

const read = (
  uid: string,
  rows: Row[],
  extra: Partial<EmploymentVote> = {},
): EmploymentVote => ({ uid, verdict: "read", rows, ...extra });
const brak = (uid: string): EmploymentVote => ({ uid, verdict: "none" });
const unreadable = (uid: string): EmploymentVote => ({
  uid,
  verdict: "unreadable",
});

const WICESTAROSTA = row(STAROSTWO, "wicestarosta");
const PREZES = row(COMPANY, "prezes");
const KEY_WICESTAROSTA = `regon:${REGON_A}#office_deputy`;

describe("role chips", () => {
  it("folds every chip's own label into its family", () => {
    for (const chip of roleChips) {
      expect([chip.id, roleFamilyOf(chip.label)]).toEqual([
        chip.id,
        chip.family,
      ]);
    }
  });

  it("offers a gmina's mayor chips as PKW names its office", () => {
    const labels = (office: string | null) =>
      rolesFor("urzad_gminy", office).map((chip) => chip.label);
    expect(labels("Burmistrz")).toEqual([
      "burmistrz",
      "zastępca burmistrza",
      "sekretarz",
      "skarbnik",
      "naczelnik",
      "kierownik",
      "pracownik",
      "Inne",
    ]);
    expect(labels("Prezydent").slice(0, 2)).toEqual([
      "prezydent",
      "zastępca prezydenta",
    ]);
    expect(labels("Wójt").slice(0, 2)).toEqual(["wójt", "zastępca wójta"]);
    // With no office known, all three of each.
    expect(labels(null).slice(0, 6)).toEqual([
      "wójt",
      "burmistrz",
      "prezydent",
      "zastępca wójta",
      "zastępca burmistrza",
      "zastępca prezydenta",
    ]);
  });

  it("offers „Inne” last at every kind of institution", () => {
    for (const kind of institutionKinds) {
      expect(rolesFor(kind).at(-1)?.id).toBe("inne");
    }
    expect(rolesFor("starostwo").map((chip) => chip.label)).toEqual([
      "starosta",
      "wicestarosta",
      "członek zarządu",
      "sekretarz",
      "skarbnik",
      "naczelnik",
      "kierownik",
      "pracownik",
      "Inne",
    ]);
  });

  it("gives every family one kind, and marks the register's organs", () => {
    expect(familyKind("mayor")).toBe("elected");
    expect(familyKind("deputy_mayor")).toBe("executive");
    expect(familyKind("supervisory_board")).toBe("managerial");
    expect(familyKind("staff")).toBe("staff");
    // Only free-text names fold to it.
    expect(familyKind("attorney")).toBeNull();
    expect(familyKind(null)).toBeNull();
    for (const chip of roleChips) {
      expect(chip.kind).toBe(familyKind(chip.family));
    }
    expect(isBoardFamily("management_board")).toBe(true);
    expect(isBoardFamily("supervisory_board")).toBe(true);
    expect(isBoardFamily("commercial_proxy")).toBe(true);
    expect(isBoardFamily("director")).toBe(false);
    expect(isBoardFamily(null)).toBe(false);
    expect(seatRoles.map((chip) => chip.id)).toContain("komisja_rewizyjna");
  });
});

describe("roleFamilyOf", () => {
  it.each([
    ["prezes", "management_board"],
    ["Prezes Zarządu", "management_board"],
    ["zastępca prezesa", "management_board"],
    ["Zarząd", "management_board"],
    ["członek zarządu, CFO", "management_board"],
    ["dyrektor", "director"],
    ["p.o. dyrektora", "director"],
    ["pełniący obowiązki dyrektora", "director"],
    ["dyrektor Wydziału Kontroli i Skarg", "director"],
    ["Dyrektor Szkoły im. Prezydenta Miasta", "director"],
    ["z/ca dyrektora", "deputy_director"],
    ["wicedyrektor", "deputy_director"],
    ["Zastępca Wójta", "deputy_mayor"],
    ["Z-ca Burmistrza", "deputy_mayor"],
    ["wiceprezydent", "deputy_mayor"],
    ["wójt gminy", "mayor"],
    ["Rada Nadzorcza", "supervisory_board"],
    ["członek rady nadzorczej", "supervisory_board"],
    ["prezes rady nadzorczej", "supervisory_board"],
    ["Rada Społeczna", "supervisory_board"],
    ["Prokurent", "commercial_proxy"],
    ["Pełnomocnik", "attorney"],
    ["wicestarosta", "office_deputy"],
    ["sekretarz stanu", "office_deputy"],
    ["starosta powiatu", "office_head"],
    ["sekretarz powiatu", "secretary"],
    ["naczelnik wydziału", "manager"],
    ["zastępca naczelnika wydziału", "manager"],
    ["główny specjalista", "staff"],
  ])("folds %j into %s", (name, family) => {
    expect(roleFamilyOf(name)).toBe(family);
  });

  it.each([
    [""],
    ["radny"],
    ["przewodniczący rady"],
    ["sekretarz rady"],
    ["członek"],
    ["ministerstwo"],
    ["zlecenie dla"],
  ])("folds %j into no family", (name) => {
    expect(roleFamilyOf(name)).toBeNull();
  });

  it("folds a missing name into no family", () => {
    expect(roleFamilyOf(null)).toBeNull();
    expect(roleFamilyOf(undefined)).toBeNull();
  });
});

describe("employerKey", () => {
  it("keys a place, a REGON and a name typed with its kind", () => {
    expect(employerKey(COMPANY)).toBe("place:fxCompany0001");
    expect(employerKey({ regon: "123-456-785" })).toBe(`regon:${REGON_A}`);
    expect(
      employerKey({
        text: "Gminny Ośrodek Kultury w Przykładowie",
        kind: "kultura_sport",
      }),
    ).toBe("text:gminny osrodek kultury w przykladowie|kultura_sport");
  });

  it("leads a REGON to the place that has it", () => {
    const lookup = employerLookup({
      places: [{ id: "fxStarostwo01", regonNumber: REGON_A }],
    });
    expect(employerKey(STAROSTWO, lookup)).toBe("place:fxStarostwo01");
    expect(employerKey({ regon: REGON_LOCAL }, lookup)).toBe(
      `regon:${REGON_LOCAL}`,
    );
  });

  it("leads a catalogue row to its company's place by KRS number", () => {
    const lookup = employerLookup({
      places: [{ id: "fxCompany0001", krsNumber: "71567" }],
      krsByRegon: [[REGON_B, "0000071567"]],
    });
    expect(employerKey({ regon: REGON_B }, lookup)).toBe(
      employerKey(COMPANY, lookup),
    );
  });

  it("keys a row by its employer and its role's family", () => {
    expect(rowKey(PREZES)).toBe(
      rowKey(row(COMPANY, "czlonek_zarzadu", { other: null })),
    );
    expect(rowKey(PREZES)).not.toBe(rowKey(row(COMPANY, "rada_nadzorcza")));
    expect(rowKey(row(COMPANY, "inne", { other: "Rzecznik prasowy" }))).toBe(
      "place:fxCompany0001#inne:rzecznik prasowy",
    );
    expect(rowKey(row(COMPANY, "inne", { other: "kierownik działu" }))).toBe(
      "place:fxCompany0001#manager",
    );
  });
});

describe("settleEmployment", () => {
  it("settles a 2-0 on a row", () => {
    const settled = settleEmployment([
      read("a", [WICESTAROSTA]),
      read("b", [WICESTAROSTA]),
    ]);
    expect(settled).toMatchObject({
      status: "agreed",
      rows: [
        {
          key: KEY_WICESTAROSTA,
          employer: STAROSTWO,
          family: "office_deputy",
          role: "wicestarosta",
          other: null,
          start: null,
          readers: 2,
        },
      ],
      asOf: null,
      kind: null,
      readers: 2,
    });
  });

  it("waits on a 2-1 and settles a 3-1", () => {
    const twoOne = [
      read("a", [WICESTAROSTA]),
      read("b", [WICESTAROSTA]),
      brak("c"),
    ];
    const open = settleEmployment(twoOne);
    expect(open.status).toBe("open");
    expect(open.tally.rows[KEY_WICESTAROSTA]).toEqual({
      for: 2,
      against: 1,
      unsure: 0,
    });
    expect(
      settleEmployment([...twoOne, read("d", [WICESTAROSTA])]),
    ).toMatchObject({
      status: "agreed",
      rows: [{ key: KEY_WICESTAROSTA, readers: 3 }],
      readers: 4,
    });
  });

  it("counts „Brak” against every row", () => {
    expect(
      settleEmployment([read("a", [WICESTAROSTA]), brak("b")]).status,
    ).toBe("open");
    // Two „Brak”: the line names no post.
    expect(settleEmployment([brak("a"), brak("b")])).toMatchObject({
      status: "agreed",
      rows: [],
      asOf: null,
      readers: 2,
    });
    // One reader's row against three „Brak” is rejected.
    expect(
      settleEmployment([
        read("a", [WICESTAROSTA]),
        brak("b"),
        brak("c"),
        brak("d"),
      ]),
    ).toMatchObject({ status: "agreed", rows: [], readers: 4 });
  });

  it("agrees there is no post only when „Brak” wins as a row would", () => {
    const other = (uid: string, n: number) =>
      read(uid, [row({ place: `fxPlace${n}` }, "dyrektor")]);
    // Four readers, four different posts: every row is rejected, and
    // nobody said „Brak”.
    const four = [other("a", 1), other("b", 2), other("c", 3), other("d", 4)];
    expect(settleEmployment(four).status).toBe("open");
    expect(
      settleEmployment([...four, other("e", 5), other("f", 6)]).status,
    ).toBe("disputed");
    const split = [other("a", 1), other("b", 2), brak("c"), brak("d")];
    expect(settleEmployment(split).status).toBe("open");
    expect(settleEmployment([...split, brak("e"), brak("f")])).toMatchObject({
      status: "agreed",
      rows: [],
      readers: 6,
    });
  });

  it("agrees only once every row anybody gave is decided", () => {
    const both = read("a", [WICESTAROSTA, PREZES]);
    expect(settleEmployment([both, read("b", [WICESTAROSTA])]).status).toBe(
      "open",
    );
    expect(
      settleEmployment([
        both,
        read("b", [WICESTAROSTA]),
        read("c", [WICESTAROSTA]),
      ]).status,
    ).toBe("open");
    const settled = settleEmployment([
      both,
      read("b", [WICESTAROSTA]),
      read("c", [WICESTAROSTA]),
      read("d", [WICESTAROSTA]),
    ]);
    expect(settled).toMatchObject({
      status: "agreed",
      rows: [{ key: KEY_WICESTAROSTA, readers: 4 }],
    });
    expect(settled.tally.rows[rowKey(PREZES)]).toEqual({
      for: 1,
      against: 3,
      unsure: 0,
    });
  });

  it("hears no voice for or against a row marked „Niepewne”", () => {
    const unsure = read("b", [{ ...WICESTAROSTA, unsure: true }]);
    const open = settleEmployment([read("a", [WICESTAROSTA]), unsure]);
    expect(open.status).toBe("open");
    expect(open.tally.rows[KEY_WICESTAROSTA]).toEqual({
      for: 1,
      against: 0,
      unsure: 1,
    });
    expect(
      settleEmployment([
        read("a", [WICESTAROSTA]),
        unsure,
        read("c", [WICESTAROSTA]),
      ]),
    ).toMatchObject({
      status: "agreed",
      rows: [{ key: KEY_WICESTAROSTA, readers: 2 }],
    });
    // A reading of unsure rows only is against nothing, and its row is
    // rejected by two readers sure of another.
    const settled = settleEmployment([
      read("a", [{ ...PREZES, unsure: true }]),
      read("b", [WICESTAROSTA]),
      read("c", [WICESTAROSTA]),
    ]);
    expect(settled).toMatchObject({
      status: "agreed",
      rows: [{ key: KEY_WICESTAROSTA, readers: 2 }],
    });
    expect(settled.tally.rows[rowKey(PREZES)]).toEqual({
      for: 0,
      against: 2,
      unsure: 1,
    });
  });

  it("finds a band unreadable after three „Nieczytelne” and no row of two", () => {
    expect(
      settleEmployment([unreadable("a"), unreadable("b"), unreadable("c")]),
    ).toMatchObject({ status: "unreadable", readers: 3 });
    expect(
      settleEmployment([
        unreadable("a"),
        unreadable("b"),
        read("c", [WICESTAROSTA]),
      ]).status,
    ).toBe("open");
    expect(
      settleEmployment([
        unreadable("a"),
        unreadable("b"),
        unreadable("c"),
        read("d", [WICESTAROSTA]),
      ]).status,
    ).toBe("unreadable");
    expect(
      settleEmployment([
        unreadable("a"),
        unreadable("b"),
        unreadable("c"),
        read("d", [WICESTAROSTA]),
        read("e", [WICESTAROSTA]),
      ]).status,
    ).toBe("agreed");
  });

  it("disputes six voices without agreement", () => {
    const voices = ["a", "b", "c", "d", "e", "f"].map((uid, i) =>
      read(uid, [i % 2 ? PREZES : WICESTAROSTA]),
    );
    expect(settleEmployment(voices.slice(0, 5)).status).toBe("open");
    expect(settleEmployment(voices)).toMatchObject({
      status: "disputed",
      tally: { voices: 6 },
    });
  });

  it("takes a page's KRS place and its catalogue row as one employer", () => {
    const answers = [
      read("a", [PREZES]),
      read("b", [row({ regon: REGON_B }, "prezes")]),
    ];
    expect(settleEmployment(answers).status).toBe("open");
    const lookup = employerLookup({
      places: [{ id: "fxCompany0001", krsNumber: "0000071567" }],
      krsByRegon: [[REGON_B, "71567"]],
    });
    expect(settleEmployment(answers, { lookup })).toMatchObject({
      status: "agreed",
      rows: [
        {
          key: "place:fxCompany0001#management_board",
          employer: COMPANY,
          role: "prezes",
          readers: 2,
        },
      ],
    });
  });

  it("settles the chip within a family, or leaves it to an admin", () => {
    expect(
      settleEmployment([
        read("a", [PREZES]),
        read("b", [row(COMPANY, "czlonek_zarzadu")]),
      ]),
    ).toMatchObject({
      status: "agreed",
      rows: [{ family: "management_board", role: null, readers: 2 }],
    });
    // „Inne” text folding to no family is a row of its own.
    expect(
      settleEmployment([
        read("a", [row(COMPANY, "inne", { other: "Rzecznik prasowy" })]),
        read("b", [row(COMPANY, "inne", { other: "rzecznik  prasowy" })]),
      ]),
    ).toMatchObject({
      status: "agreed",
      rows: [
        {
          key: "place:fxCompany0001#inne:rzecznik prasowy",
          role: "inne",
          other: "Rzecznik prasowy",
        },
      ],
    });
    // „Inne” text that folds to a chip's family meets the chip.
    expect(
      settleEmployment([
        read("a", [row(STAROSTWO, "naczelnik")]),
        read("b", [
          row(STAROSTWO, "inne", { other: "zastępca naczelnika wydziału" }),
        ]),
      ]),
    ).toMatchObject({
      status: "agreed",
      rows: [{ family: "manager", role: null, other: null }],
    });
  });

  it("settles „Stan na”, the kind and „od” field by field", () => {
    const dated = (
      uid: string,
      asOf: string,
      extra: Partial<EmploymentVote> = {},
    ) => read(uid, [WICESTAROSTA], { asOf, ...extra });
    expect(
      settleEmployment([dated("a", "2024-12-31"), dated("b", "2024-12-31")]),
    ).toMatchObject({ asOf: "2024-12-31", kind: "annual" });
    expect(
      settleEmployment([dated("a", "2024"), dated("b", "2024")]),
    ).toMatchObject({ asOf: "2024", kind: "annual" });
    // A year typed alone supports the days in it, as for birth dates.
    expect(
      settleEmployment([dated("a", "2024"), dated("b", "2024-05-28")]),
    ).toMatchObject({ asOf: "2024-05-28", kind: null });
    expect(
      settleEmployment([
        dated("a", "2024-05-28", { declarationKind: "start" }),
        dated("b", "2024-05-28", { declarationKind: "start" }),
      ]),
    ).toMatchObject({ asOf: "2024-05-28", kind: "start" });
    // Unsettled is absent; the rows stand.
    expect(
      settleEmployment([dated("a", "2024-12-31"), dated("b", "2023-12-31")]),
    ).toMatchObject({
      status: "agreed",
      rows: [{ key: KEY_WICESTAROSTA }],
      asOf: null,
      kind: null,
    });
    // „Niepewne” on the date is no voice.
    expect(
      settleEmployment([
        dated("a", "2024-12-31", { asOfUnsure: true }),
        dated("b", "2024-12-31"),
      ]),
    ).toMatchObject({ status: "agreed", asOf: null });
    const started = (uid: string, start?: string) =>
      read(uid, [{ ...WICESTAROSTA, start }]);
    expect(
      settleEmployment([started("a", "2019-03-01"), started("b", "2019")]),
    ).toMatchObject({ rows: [{ start: "2019-03-01" }] });
    expect(
      settleEmployment([started("a", "2019-03-01"), started("b")]),
    ).toMatchObject({ rows: [{ start: null }] });
  });

  it("hears each reader once, by their last answer with a say", () => {
    expect(
      settleEmployment([
        brak("a"),
        read("a", [WICESTAROSTA]),
        read("b", [WICESTAROSTA]),
      ]).status,
    ).toBe("agreed");
    const voiceless = [
      read("pipeline-declarations", [WICESTAROSTA]),
      read("anon:x", [WICESTAROSTA], { votes: false }),
      { uid: "c", verdict: "skip" } as const,
      read("d", [WICESTAROSTA], { control: true }),
      read("e", [WICESTAROSTA], { imageHash: "old" }),
    ];
    const open = settleEmployment([read("a", [WICESTAROSTA]), ...voiceless], {
      imageHash: "new",
    });
    expect(open.status).toBe("open");
    expect(open.tally.voices).toBe(1);
    expect(
      settleEmployment(
        [
          read("a", [WICESTAROSTA], { imageHash: "new" }),
          read("b", [WICESTAROSTA], { imageHash: "new" }),
        ],
        { imageHash: "new" },
      ).status,
    ).toBe("agreed");
  });
});

describe("employmentPriority", () => {
  const draft = { published: false };
  const held = { status: "held", reason: "no_public_post" };

  it("serves first a draft held for having no paid public post", () => {
    expect(
      employmentPriority({ page: draft, paidPost: false, publication: held }),
    ).toBe(0);
    expect(
      employmentPriority({
        page: draft,
        paidPost: false,
        publication: { ...held, declinedAt: "2026-11-02T10:00:00Z" },
      }),
    ).toBe(1);
    expect(
      employmentPriority({
        page: draft,
        paidPost: false,
        publication: { status: "held", reason: "two_pages" },
      }),
    ).toBe(1);
    expect(employmentPriority({ page: draft, paidPost: false })).toBe(1);
  });

  it("serves public pages and pages with a paid post after drafts", () => {
    expect(
      employmentPriority({
        page: { published: true },
        paidPost: false,
        publication: held,
      }),
    ).toBe(2);
    expect(employmentPriority({ page: draft, paidPost: true })).toBe(3);
    expect(
      employmentPriority({ page: { published: true }, paidPost: true }),
    ).toBe(3);
  });

  it("moves back a sitting mayor's item and a Kontrola read", () => {
    expect(
      employmentPriority({
        page: draft,
        paidPost: false,
        publication: held,
        sittingMayor: true,
      }),
    ).toBe(0.5);
    expect(
      employmentPriority({
        page: { published: true },
        paidPost: false,
        control: true,
      }),
    ).toBeCloseTo(2.9);
  });
});

describe("the upload", () => {
  const png = "iVBORw0KGgo=";
  const header = {
    typed: true,
    strips: [{ page: 0, png }],
    asOf: { value: "2024-12-31", score: 0.97 },
    filedOn: { value: "2025-04-28", score: 0.91 },
  };
  const employer = {
    typed: true,
    strips: [{ page: 0, png }],
    lines: [{ strip: 0, top: 4, bottom: 38 }],
    imageHash: "c".repeat(64),
    suggestions: [{ employer: { regon: REGON_A }, role: "wicestarosta" }],
  };
  const item = {
    id: `${"a".repeat(64)}-p0`,
    cutVersion: 1,
    header,
    employer,
  };

  it("accepts a printed item with its suggestions and header dates", () => {
    const parsed = employmentIngestSchema.parse({
      tag: "bip-declarations-employment-1",
      items: [item],
    });
    expect(parsed.items[0]).toMatchObject({
      later: false,
      header: { asOf: { value: "2024-12-31" }, lines: [] },
      employer: { suggestions: [{ role: "wicestarosta" }] },
    });
  });

  it("accepts handwriting across a page break, without suggestions", () => {
    const handwritten = {
      ...employer,
      typed: false,
      suggestions: [],
      strips: [
        { page: 0, png },
        { page: 1, png },
      ],
      lines: [
        { strip: 0, top: 10, bottom: 60 },
        { strip: 1, top: 0, bottom: 44 },
      ],
    };
    expect(
      employmentItemSchema.safeParse({
        ...item,
        header: { ...header, typed: false, asOf: null, filedOn: null },
        employer: handwritten,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["suggestions on handwriting", { employer: { ...employer, typed: false } }],
    [
      "more than four suggestions",
      {
        employer: {
          ...employer,
          suggestions: Array.from({ length: 5 }, () => employer.suggestions[0]),
        },
      },
    ],
    [
      "a line on a strip the band does not have",
      {
        employer: { ...employer, lines: [{ strip: 1, top: 0, bottom: 10 }] },
      },
    ],
    [
      "„Inne” as a suggestion",
      {
        employer: {
          ...employer,
          suggestions: [{ employer: { regon: REGON_A }, role: "inne" }],
        },
      },
    ],
    [
      "text as a suggested employer",
      {
        employer: {
          ...employer,
          suggestions: [
            {
              employer: { text: "Starostwo", kind: "urzad" },
              role: "starosta",
            },
          ],
        },
      },
    ],
    ["an id that is no date page's", { id: "a".repeat(64) }],
    ["an item with no band to read", { employer: undefined }],
    [
      "a „stan na” before 1900",
      { header: { ...header, asOf: { value: "1890", score: 0.9 } } },
    ],
  ])("refuses %s", (_, change) => {
    expect(employmentItemSchema.safeParse({ ...item, ...change }).success).toBe(
      false,
    );
  });

  it("refuses more items than a request may carry", () => {
    expect(
      employmentIngestSchema.safeParse({
        tag: "t",
        items: Array.from({ length: 26 }, () => item),
      }).success,
    ).toBe(false);
  });
});

describe("answers", () => {
  const reading = {
    verdict: "read",
    rows: [
      {
        employer: { regon: "123-456-785" },
        role: "wicestarosta",
        source: "machine",
      },
      { employer: { place: "fxCompany0001" }, role: "prezes", source: "page" },
      {
        employer: { text: "Gminny Ośrodek Kultury", kind: "kultura_sport" },
        role: "inne",
        other: "instruktor",
        start: "2019",
        unsure: true,
        source: "typed",
      },
    ],
    asOf: "2024-05-28",
    declarationKind: "start",
    msOnCard: 41_000,
  };

  it("accepts a reading, its REGONs written plain", () => {
    const parsed = employmentAnswerSchema.parse(reading);
    expect(parsed.rows[0]!.employer).toEqual({ regon: REGON_A });
    expect(parsed.flags).toEqual([]);
    // The fixtures' other REGONs carry their check digits too.
    for (const regon of [REGON_B, REGON_LOCAL]) {
      expect(
        employmentAnswerSchema.safeParse({
          verdict: "read",
          rows: [{ employer: { regon }, role: "prezes", source: "typed" }],
        }).success,
      ).toBe(true);
    }
  });

  it("accepts „Brak”, „Nieczytelne” and a report without rows", () => {
    for (const verdict of ["none", "unreadable", "skip"]) {
      expect(employmentAnswerSchema.safeParse({ verdict }).success).toBe(true);
    }
    expect(
      employmentAnswerSchema.safeParse({
        verdict: "skip",
        flags: ["missing_part"],
      }).success,
    ).toBe(true);
  });

  it.each([
    ["a reading without rows", { rows: [] }],
    [
      "„Brak” with rows",
      { verdict: "none", asOf: undefined, declarationKind: undefined },
    ],
    ["a date beside „Nie widać”", { asOfUnseen: true }],
    ["a date that is no day", { asOf: "2024-02-30" }],
    [
      "an address for a name",
      {
        rows: [
          {
            employer: { text: "Szkoła, ul. Polna 5", kind: "szkola" },
            role: "dyrektor",
            source: "typed",
          },
        ],
      },
    ],
    [
      "„Inne” without the role as written",
      {
        rows: [
          {
            employer: { place: "fxCompany0001" },
            role: "inne",
            source: "typed",
          },
        ],
      },
    ],
    [
      "the role as written on a listed chip",
      {
        rows: [
          {
            employer: { place: "fxCompany0001" },
            role: "prezes",
            other: "prezes zarządu",
            source: "typed",
          },
        ],
      },
    ],
    [
      "a role that is no chip",
      {
        rows: [
          {
            employer: { place: "fxCompany0001" },
            role: "radny",
            source: "typed",
          },
        ],
      },
    ],
    [
      "a REGON whose check digit is wrong",
      {
        rows: [
          {
            employer: { regon: "123456789" },
            role: "starosta",
            source: "typed",
          },
        ],
      },
    ],
    ["a flag twice", { flags: ["missing_part", "missing_part"] }],
  ])("refuses %s", (_, change) => {
    expect(
      employmentAnswerSchema.safeParse({ ...reading, ...change }).success,
    ).toBe(false);
  });

  it("refuses a date with „Brak”", () => {
    expect(
      employmentAnswerSchema.safeParse({ verdict: "none", asOf: "2024" })
        .success,
    ).toBe(false);
  });
});

describe("looksLikeAddress", () => {
  it.each([
    "ul. Teatralna 9",
    "Urząd Gminy, ul.Polna 5",
    "al. Jana Pawła II 12",
    "os. Słoneczne 5/3",
    "Plac Wolności 1",
    "00-950 Warszawa",
  ])("finds an address in %j", (text) => {
    expect(looksLikeAddress(text)).toBe(true);
  });

  it.each([
    "Szkoła Podstawowa nr 12",
    "Zespół Szkół im. Jana Pawła II",
    "Ośrodek Sportu i Rekreacji",
    "OSiR 2",
    "Starostwo Powiatowe",
  ])("finds none in %j", (text) => {
    expect(looksLikeAddress(text)).toBe(false);
  });
});

describe("ids", () => {
  it("names a band's pictures, its answers and its entries on edges", () => {
    const item = `${"ab".repeat(32)}-p0`;
    expect(employmentImagesId(item, "employer")).toBe(`${item}-employer`);
    expect(employmentAnswerId(item, "employer", "uid1")).toBe(
      `${item}-employer_uid1`,
    );
    expect(declaredKey(item, "vii", 2)).toBe(`${item}:vii:2`);
  });

  it("keeps income off every page", () => {
    expect(DECLARED_INCOME_SHOWN).toBe(false);
  });
});
