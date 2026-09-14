import { describe, it, expect, vi } from "vitest";
import {
  attachPeople,
  buildContractQuery,
  cruContractSchema,
  encodeContractCursor,
  parseContractCursor,
  resolveNodeIds,
  toContractDoc,
  topFiveShare,
} from "../../server/utils/contracts";

// Hoisted above the import. The module under test imports `FieldPath` to spell
// out the document-id ordering; nothing here executes a query, so a stand-in is
// enough and the suite never needs firebase-admin itself.
vi.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: () => "__name__" },
}));

/** The gate this file exists for.
 *
 * Per-row partial redaction has no precedent in this repo - every other gate
 * drops a whole row, a whole response or a whole node - and one `hasUser`
 * mistake bakes a draft name into a 60 second CDN entry that nothing in this
 * repo can purge. So the assertions below are made against
 * `JSON.stringify(result)` rather than against a flag on it: what matters is
 * that the bytes were never sent, not that something marked them.
 */

type Doc = { id: string; data: Record<string, unknown> };
type Call = { collection: string; kind: "where" | "get"; field?: string };

/** A Firestore stand-in that answers `where`/`in`/`array-contains` in memory.
 *
 * Hand-built rather than mocked out of the library so that the recorded calls
 * are part of the contract: one edges query per chunk of 30, and never a
 * filter on `source`. A future author reaching for `fetchEdgesClose` - which
 * takes no type argument and issues both `source in` and `target in`, pulling
 * every election, seat, owns and mentions edge in both directions - fails
 * here.
 */
function fakeDb(collections: Record<string, Doc[]>, calls: Call[] = []) {
  const matches = (
    data: Record<string, unknown>,
    filter: { field: string; op: string; value: unknown },
  ) => {
    const actual = data[filter.field];
    if (filter.op === "in") return (filter.value as unknown[]).includes(actual);
    if (filter.op === "array-contains") {
      return Array.isArray(actual) && actual.includes(filter.value);
    }
    return actual === filter.value;
  };

  const query = (name: string) => {
    const filters: { field: string; op: string; value: unknown }[] = [];
    const self: Record<string, unknown> = {
      where: (field: string, op: string, value: unknown) => {
        calls.push({ collection: name, kind: "where", field });
        filters.push({ field, op, value });
        return self;
      },
      select: () => self,
      orderBy: () => self,
      startAfter: () => self,
      limit: () => self,
      doc: (id: string) => ({ id, collectionName: name }),
      get: async () => {
        calls.push({ collection: name, kind: "get" });
        const docs = (collections[name] ?? []).filter((doc) =>
          filters.every((filter) => matches(doc.data, filter)),
        );
        return {
          size: docs.length,
          empty: docs.length === 0,
          docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })),
        };
      },
    };
    return self;
  };

  return {
    collection: (name: string) => query(name),
    getAll: async (...args: unknown[]) => {
      const refs = args.filter(
        (arg): arg is { id: string; collectionName: string } =>
          !!arg && typeof arg === "object" && "collectionName" in arg,
      );
      return refs.map((ref) => {
        const doc = (collections[ref.collectionName] ?? []).find(
          (candidate) => candidate.id === ref.id,
        );
        return { id: ref.id, exists: !!doc, data: () => doc?.data };
      });
    },
  } as never;
}

const company = (id: string, extra: Record<string, unknown> = {}): Doc => ({
  id,
  data: { type: "place", name: `Instytucja ${id}`, published: true, ...extra },
});

const person = (id: string, name: string, published: boolean): Doc => ({
  id,
  data: { type: "person", name, published, parties: ["PiS"] },
});

const employment = (
  id: string,
  source: string,
  target: string,
  published: boolean,
  extra: Record<string, unknown> = {},
): Doc => ({
  id,
  data: {
    type: "employed",
    source,
    target,
    published,
    name: "Prezes Zarządu",
    start_date: "2020-01-01",
    ...extra,
  },
});

/** The four-edge matrix, which is the whole of the gate.
 *
 * Measured across the graph, `(edge published, person published)` is
 * (false,false) 18 661 · (true,true) 3 443 · (false,true) 252 · (true,false) 4,
 * so all four corners are real and three of them must never reach a logged out
 * reader.
 */
function gateFixture() {
  return fakeDb({
    nodes: [
      company("c1"),
      person("p1", "Jan Published", true),
      person("p2", "Anna Draft-Edge", true),
      person("p3", "Piotr Draft-Node", false),
      person("p4", "Maria Draft-Both", false),
    ],
    edges: [
      employment("e1", "p1", "c1", true),
      employment("e2", "p2", "c1", false),
      employment("e3", "p3", "c1", true),
      employment("e4", "p4", "c1", false),
    ],
  });
}

describe("attachPeople - the gate", () => {
  it("sends a logged out reader one name and a count of the rest", async () => {
    const result = await attachPeople(gateFixture(), ["c1"], false);

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("Anna");
    expect(serialised).not.toContain("Piotr");
    expect(serialised).not.toContain("Maria");

    expect(result).toHaveLength(1);
    expect(result[0]!.people).toHaveLength(1);
    expect(result[0]!.people[0]!.name).toBe("Jan Published");
    expect(result[0]!.people[0]!.ours).toBe(false);
    expect(result[0]!.hiddenPeople).toBe(3);
    expect(result[0]!.morePeople).toBe(0);
  });

  it("sends a signed-in reader all four, marked", async () => {
    const result = await attachPeople(gateFixture(), ["c1"], true);

    expect(result[0]!.people).toHaveLength(4);
    expect(result[0]!.people.filter((p) => p.ours)).toHaveLength(3);
    expect(result[0]!.hiddenPeople).toBe(0);
    // Published first: a draft must never push a published person off the top,
    // because the cap below cuts from the bottom.
    expect(result[0]!.people[0]!.ours).toBe(false);
  });

  it("caps rather than gates: nine published people are six and a +3", async () => {
    const people = Array.from({ length: 9 }, (_, i) =>
      person(`p${i}`, `Osoba ${i}`, true),
    );
    const db = fakeDb({
      nodes: [company("c1"), ...people],
      edges: people.map((p, i) => employment(`e${i}`, p.id, "c1", true)),
    });

    const result = await attachPeople(db, ["c1"], false);

    expect(result[0]!.people).toHaveLength(6);
    expect(result[0]!.morePeople).toBe(3);
    // The difference the copy hangs on: „+3 więcej" is a truncation and
    // „po zalogowaniu" is a gate, and a truncation that reads like a gate is a
    // lie about coverage.
    expect(result[0]!.hiddenPeople).toBe(0);
  });

  it("issues one edges query per chunk of 30 and never filters on source", async () => {
    const calls: Call[] = [];
    const db = fakeDb({ nodes: [], edges: [] }, calls);

    await attachPeople(
      db,
      Array.from({ length: 31 }, (_, i) => `c${i}`),
      false,
    );

    const gets = calls.filter(
      (c) => c.collection === "edges" && c.kind === "get",
    );
    expect(gets).toHaveLength(2);
    const fields = calls
      .filter((c) => c.collection === "edges" && c.kind === "where")
      .map((c) => c.field);
    expect(fields).toEqual(["target", "type", "target", "type"]);
    expect(fields).not.toContain("source");
    // And no `published` filter: there is no (target, type, published)
    // composite in firestore.indexes.json, and the count of the unpublished
    // rows is what `hiddenPeople` is.
    expect(fields).not.toContain("published");
  });

  it("drops a deleted edge without counting it as hidden", async () => {
    const db = fakeDb({
      nodes: [company("c1"), person("p1", "Jan Published", true)],
      edges: [employment("e1", "p1", "c1", true, { deleted: true })],
    });

    const result = await attachPeople(db, ["c1"], true);

    expect(result).toHaveLength(0);
  });

  it("names a hospital's organ what it is", async () => {
    const db = fakeDb({
      nodes: [
        company("c1", { supervisoryBody: "rada-spoleczna" }),
        person("p1", "Jan Published", true),
      ],
      edges: [employment("e1", "p1", "c1", true, { name: "Rada Nadzorcza" })],
    });

    const result = await attachPeople(db, ["c1"], false);

    // Through `displayRole`, so the top publishing blocker on this site - a
    // rada społeczna printed as Rada Nadzorcza - cannot reappear here.
    expect(result[0]!.people[0]!.role).toBe("Rada Społeczna");
  });

  it("names a person once however many seats they hold at one institution", async () => {
    const db = fakeDb({
      nodes: [company("c1"), person("p1", "Jan Published", true)],
      edges: [
        employment("e1", "p1", "c1", true, { start_date: "2015-01-01" }),
        employment("e2", "p1", "c1", true, { name: "Prezes" }),
      ],
    });

    const result = await attachPeople(db, ["c1"], false);

    expect(result[0]!.people).toHaveLength(1);
    expect(result[0]!.morePeople).toBe(0);
  });
});

describe("parseContractCursor", () => {
  it("splits on the first pipe, because a document id may contain one", () => {
    expect(parseContractCursor("2026-08-01|cru_a|b", "data")).toEqual({
      value: "2026-08-01",
      id: "cru_a|b",
    });
  });

  it("coerces for the money ordering and leaves the date one a string", () => {
    expect(parseContractCursor("1436|cru_x", "kwota")).toEqual({
      value: 1436,
      id: "cru_x",
    });
    expect(parseContractCursor("2026-08-01|cru_x", "data")).toEqual({
      value: "2026-08-01",
      id: "cru_x",
    });
  });

  it("returns null on garbage rather than throwing", () => {
    // A cursor is a url parameter, so a truncated one has to be a 200 with the
    // first page on it.
    expect(parseContractCursor(undefined, "data")).toBeNull();
    expect(parseContractCursor("", "data")).toBeNull();
    expect(parseContractCursor("no-pipe-here", "data")).toBeNull();
    expect(parseContractCursor("|cru_x", "data")).toBeNull();
    expect(parseContractCursor("1436|", "kwota")).toBeNull();
    // A string against the numeric `valueSort` would resume at the wrong end
    // of the collection rather than fail.
    expect(parseContractCursor("wczoraj|cru_x", "kwota")).toBeNull();
  });

  it("round-trips what encodeContractCursor writes", () => {
    const row = { id: "cru_x", valueSort: -1, signedSort: "1970-01-01" };
    expect(
      parseContractCursor(encodeContractCursor(row, "kwota"), "kwota"),
    ).toEqual({ value: -1, id: "cru_x" });
    expect(
      parseContractCursor(encodeContractCursor(row, "data"), "data"),
    ).toEqual({ value: "1970-01-01", id: "cru_x" });
  });
});

describe("toContractDoc", () => {
  const payload = (extra: Record<string, unknown> = {}) =>
    cruContractSchema.parse({
      id_umowy: "0198e0f0-1111-2222-3333-444455556666",
      zrodlo: "umowa",
      status_umowy: "Aktywna",
      data_zawarcia_umowy: "2026-07-14",
      przedmiot_umowy: "Dostawa papieru",
      wartosc_przedmiotu: 1436,
      strony: [
        {
          kolejnosc: 0,
          rodzaj: "JSFP",
          nazwa: "SZPITAL UNIWERSYTECKI W KRAKOWIE",
          nip: "675-000-11-11",
          regon9: "351234567",
          miejscowosc: "Kraków",
        },
      ],
      ...extra,
    });

  it("orders the sort fields even where the printed ones are missing", () => {
    // Firestore excludes a document that lacks the ordered field, so without
    // these two the 764 valueless contracts vanish from every money-sorted
    // view and the 42 `wynik` rows from the newest-first one, silently.
    expect(toContractDoc(payload({ wartosc_przedmiotu: null })).valueSort).toBe(
      -1,
    );
    // 0 zł is a real value 251 contracts carry, and it must sort above „no
    // figure at all" rather than among it.
    expect(toContractDoc(payload({ wartosc_przedmiotu: 0 })).valueSort).toBe(0);
    expect(toContractDoc(payload({ wartosc_przedmiotu: 0 })).value).toBe(0);
  });

  it("falls back through publishedAt to the epoch for signedSort", () => {
    expect(toContractDoc(payload()).signedSort).toBe("2026-07-14");
    expect(
      toContractDoc(
        payload({ data_zawarcia_umowy: null, data_publikacji: "2026-07-20" }),
      ).signedSort,
    ).toBe("2026-07-20");
    expect(
      toContractDoc(payload({ data_zawarcia_umowy: null })).signedSort,
    ).toBe("1970-01-01");
  });

  it("never lets a private individual's name reach the document", () => {
    const doc = toContractDoc(
      payload({
        ma_osobe_fizyczna: true,
        strony: [
          {
            kolejnosc: 0,
            rodzaj: "JSFP",
            nazwa: "UNIWERSYTET ŚLĄSKI W KATOWICACH",
            nip: "9540000001",
          },
          {
            kolejnosc: 1,
            rodzaj: "Osoba fizyczna",
            imie: "Aktor",
            nazwisko: "Nazwiskowy",
          },
        ],
      }),
    );

    // The storage boundary, not the template: the decision has to be provable
    // where the bytes are written.
    const serialised = JSON.stringify(doc);
    expect(serialised).not.toContain("Aktor");
    expect(serialised).not.toContain("Nazwiskowy");
    expect(doc.suppliers[0]!.kind).toBe("osoba");
    expect(doc.suppliers[0]!.name).toBeUndefined();
    // Which is what suppresses the „Zobacz w rejestrze" link - the one element
    // that turns an anonymised row back into a one-click lookup of the name.
    expect(doc.hasIndividual).toBe(true);
  });

  it("keeps a wynik row rather than dropping it", () => {
    const doc = toContractDoc(
      cruContractSchema.parse({
        id_umowy: "0198e0f0-9999-0000-1111-222233334444",
        zrodlo: "wynik",
        detale_blad: "Brak danych szczegółowych",
      }),
    );

    // Dropping them would be a silent edit of the register; they are rendered
    // as one honest line instead.
    expect(doc.detailsUnavailable).toBe(true);
    expect(doc.buyer).toEqual({ role: "buyer" });
    expect(doc.suppliers).toEqual([]);
    expect(doc.signedSort).toBe("1970-01-01");
    expect(doc.valueSort).toBe(-1);
  });

  it("collects both join keys the register carries", () => {
    // There is no KRS number anywhere in CRU: NIP and the nine-digit REGON are
    // the only keys, and `nips` is what makes a later publish repairable with
    // one array-contains per identifier.
    expect(toContractDoc(payload()).nips).toEqual(["6750001111", "351234567"]);
    expect(toContractDoc(payload()).buyer.nip).toBe("6750001111");
  });

  it("reads the redactions the register answers with", () => {
    const doc = toContractDoc(
      payload({
        wartosc_przedmiotu: 4200,
        niejawnosc_wartosci_przedmiotu: {
          zakres: "Wartość umowy",
          podstawa: "art. 5 ust. 2 ustawy o dostępie do informacji publicznej",
        },
      }),
    );

    // Five contracts carry the flag *and* a figure, so the two are separate
    // questions and neither is inferred from the other.
    expect(doc.value).toBe(4200);
    expect(doc.valueRedaction?.basis).toContain("art. 5");
  });
});

describe("resolveNodeIds", () => {
  it("links both ends and keeps the register's keys for the ones it cannot", async () => {
    const db = fakeDb({
      nodes: [
        {
          id: "n-szpital",
          data: {
            type: "place",
            name: "Szpital Uniwersytecki w Krakowie",
            nipNumber: "6750001111",
          },
        },
      ],
    });
    const docs = [
      toContractDoc(
        cruContractSchema.parse({
          id_umowy: "a-b",
          zrodlo: "umowa",
          strony: [
            {
              kolejnosc: 0,
              rodzaj: "JSFP",
              nazwa: "SZPITAL",
              nip: "6750001111",
            },
            {
              kolejnosc: 1,
              rodzaj: "Przedsiębiorca",
              nazwa: "DOSTAWCA SP. Z O.O.",
              nip: "1111111111",
            },
          ],
        }),
      ),
    ];

    const summary = await resolveNodeIds(db, docs);

    expect(docs[0]!.buyer.nodeId).toBe("n-szpital");
    // The cased name off the node, not the register's block capitals.
    expect(docs[0]!.buyer.nodeName).toBe("Szpital Uniwersytecki w Krakowie");
    // Real arrays: `sanitizeFirestoreData` would turn these into numbered-key
    // maps, against which `array-contains` silently matches nothing.
    expect(Array.isArray(docs[0]!.nodeIds)).toBe(true);
    expect(docs[0]!.nodeIds).toEqual(["n-szpital"]);
    expect(docs[0]!.buyerNodeId).toBe("n-szpital");
    expect(docs[0]!.supplierNodeIds).toEqual([]);
    expect(docs[0]!.linked).toBe(true);
    expect(docs[0]!.bothLinked).toBe(false);
    expect(summary).toEqual({
      linked: 1,
      bothLinked: 0,
      unresolvedNips: ["1111111111"],
    });
  });
});

describe("buildContractQuery", () => {
  it("filters a company's contracts by role and never orders on a printed field", () => {
    const calls: Call[] = [];
    const db = fakeDb({ contracts: [] }, calls);

    buildContractQuery(db, { nodeId: "n1", rola: "zamawiajacy", sort: "data" });
    expect(calls.filter((c) => c.kind === "where").map((c) => c.field)).toEqual(
      ["buyerNodeId"],
    );

    calls.length = 0;
    buildContractQuery(db, { nodeId: "n1", rola: "wykonawca" });
    expect(calls.map((c) => c.field)).toEqual(["supplierNodeIds"]);

    calls.length = 0;
    buildContractQuery(db, { nodeId: "n1", rola: "all" });
    expect(calls.map((c) => c.field)).toEqual(["nodeIds"]);

    calls.length = 0;
    buildContractQuery(db, { zakres: "obie" });
    expect(calls.map((c) => c.field)).toEqual(["bothLinked"]);

    calls.length = 0;
    buildContractQuery(db, { zakres: "wszystkie" });
    expect(calls).toHaveLength(0);
  });
});

describe("topFiveShare", () => {
  const rows = (values: number[]) => values.map((value) => ({ value }));

  it("says nothing below ten contracts", () => {
    // „The top five are 100% of five contracts" is not a finding.
    expect(
      topFiveShare(rows([100, 50, 20, 10, 5]), {
        totalCount: 9,
        totalValue: 185,
      }),
    ).toBeNull();
  });

  it("says nothing where the spending is not concentrated", () => {
    expect(
      topFiveShare(rows([40, 0, 0, 0, 0]), { totalCount: 20, totalValue: 100 }),
    ).toBe(null);
  });

  it("is the rows it is about to serve over the stored total", () => {
    // Recomputed per request precisely so the sentence cannot disagree with the
    // cards printed under it. Measured: for the 1 688 buyers with 20 or more
    // contracts the median top-five share is 81.3%.
    expect(
      topFiveShare(rows([40, 20, 11, 6, 4, 3]), {
        totalCount: 20,
        totalValue: 100,
      }),
    ).toBeCloseTo(0.81, 5);
  });

  it("never prints more than the whole", () => {
    expect(topFiveShare(rows([200]), { totalCount: 20, totalValue: 100 })).toBe(
      1,
    );
    expect(topFiveShare(rows([10]), null)).toBeNull();
  });
});
