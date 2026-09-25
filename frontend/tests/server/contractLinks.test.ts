import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_LINK_SUMMARY_FIELDS,
  UNCONFIRMED_IDENTITY_HOOK,
  buildContractLinkQuery,
  computeContractLinkSummary,
  contractLinkItem,
  contractLinkPayloadSchema,
  encodeContractLinkCursor,
  parseContractLinkCursor,
  readContractLinkSummary,
  toContractLinkDoc,
  type ContractLinkSort,
} from "../../server/utils/contractLinks";
import payloads from "../../scripts/contract_links.json";
import publicContracts from "../../scripts/contracts.json";
import findingContracts from "../../scripts/contract_link_contracts.json";
import {
  officeHook,
  type ContractLink,
  type ContractLinkPerson,
  type ContractLinkRow,
  type ContractLinkStrength,
  type ContractLinkTeaser,
} from "../../shared/contractLinks";

vi.mock("firebase-admin/firestore", () => ({}));

const NOW = "2026-09-25T12:00:00.000Z";

/** The fixtures by NIP - `scripts/contract_links.json`, which the emulator
 * seed writes too. */
const BUDTEST = "9990000011"; // A, public, a researched tie named in `why`
const PRZYKLAD = "9990000033"; // A, gated, rank 1
const HANDEL = "9990000022"; // B, public, no ties
const DALEKO = "9990000055"; // C, gated, more payers than listed
const SPOLDZIELNIA = "9990000044"; // D, gated

function payloadFor(nip: string) {
  const payload = payloads.find((entry) => entry.nip === nip);
  if (!payload) throw new Error(`no fixture ${nip}`);
  return payload;
}

function docFor(nip: string, overrides: Partial<ContractLink> = {}) {
  return {
    ...toContractLinkDoc(contractLinkPayloadSchema.parse(payloadFor(nip)), NOW),
    ...overrides,
  };
}

/** The gate is asserted against the serialised response, as in
 * `contracts.test.ts`: what matters is that the bytes were never sent, not that
 * something marked them hidden. */
describe("contractLinkItem", () => {
  it("sends an anonymous reader of a gated finding no name at all", () => {
    const item = contractLinkItem(
      "cru_9990000033",
      docFor(PRZYKLAD),
      false,
    ) as ContractLinkTeaser;
    const wire = JSON.stringify(item);

    expect(item.locked).toBe(true);
    expect(item.id).toBe("ukryte_1");
    for (const secret of [
      "Marek Przykładowy",
      "PRZYKŁAD",
      "GMINA PRZYKŁADOWO",
      "Przykładowo",
      "przykładowski",
      // The document id is `cru_<nip>`, and a NIP names the firm.
      "9990000033",
    ]) {
      expect(wire).not.toContain(secret);
    }
    // What a teaser is for: the class, the office in two words, and the
    // amount as a band.
    expect(item).toMatchObject({
      rank: 1,
      strength: "A",
      hook: "wójt",
      place: { wojewodztwo: "mazowieckie" },
      totalRange: [2_000_000, 5_000_000],
      dealsRange: [2, 4],
    });
  });

  it("never sends a teaser the exact amount or count, which find the contract", () => {
    const item = contractLinkItem(
      "cru_9990000033",
      docFor(PRZYKLAD, { total: 3549, deals: 1 }),
      false,
    );
    const wire = JSON.stringify(item);

    expect(wire).not.toContain("3549");
    expect(item).not.toHaveProperty("total");
    expect(item).not.toHaveProperty("deals");
    expect(item).toMatchObject({
      totalRange: [2000, 5000],
      dealsRange: [1, 1],
    });
  });

  it("claims no office in a teaser for an identity the research left open", () => {
    const doc = docFor(DALEKO);
    expect(doc.inOfficeNow).toBe(true);
    expect(doc.people[0]!.inOfficeNow).toBe(true);
    expect(contractLinkItem("cru_9990000055", doc, false)).toMatchObject({
      locked: true,
      inOfficeNow: false,
      hook: UNCONFIRMED_IDENTITY_HOOK,
    });
  });

  it("works the hook out again rather than trusting one stored under an older rule", () => {
    // As stored before a doubted identity stopped being given an office.
    const stale = docFor(DALEKO, { hook: "radny gminy" });
    expect(contractLinkItem("cru_9990000055", stale, false)).toMatchObject({
      hook: UNCONFIRMED_IDENTITY_HOOK,
    });
    const przyklad = docFor(PRZYKLAD, { hook: "cokolwiek" });
    expect(contractLinkItem("cru_9990000033", przyklad, false)).toMatchObject({
      hook: "wójt",
    });
    expect(contractLinkItem("cru_9990000033", przyklad, true)).toMatchObject({
      hook: "wójt",
    });
  });

  it("puts the in-office badge on a teaser only for somebody on it in office", () => {
    // In office per the research's note on the finding - a relative - while
    // the candidate the hook is about is not.
    const doc = docFor(SPOLDZIELNIA, { inOfficeNow: true });
    expect(doc.people.some((person) => person.inOfficeNow)).toBe(false);
    expect(contractLinkItem("cru_9990000044", doc, false)).toMatchObject({
      locked: true,
      inOfficeNow: false,
    });
    expect(
      contractLinkItem("cru_9990000033", docFor(PRZYKLAD), false),
    ).toMatchObject({ locked: true, inOfficeNow: true });
  });

  it("names a public finding to everybody but keeps its researched ties for signed-in readers", () => {
    const doc = docFor(BUDTEST);
    const anonymous = contractLinkItem(
      "cru_9990000011",
      doc,
      false,
    ) as ContractLinkRow;
    const wire = JSON.stringify(anonymous);

    expect(wire).toContain("Tomasz Testowy");
    expect(wire).toContain("BUDTEST");
    expect(wire).not.toContain("Anna Testowa");
    // The research's sentence names the partner too, so it goes with her.
    expect(doc.why).toContain("Anną Testową");
    expect(wire).not.toContain("Testową");
    expect(anonymous.why).toBeUndefined();
    // And the card is told there is more behind the login.
    expect(anonymous.hiddenTies).toBe(1);
    expect(anonymous.ties).toEqual([]);

    const signedIn = contractLinkItem(
      "cru_9990000011",
      doc,
      true,
    ) as ContractLinkRow;
    expect(JSON.stringify(signedIn)).toContain("Anna Testowa");
    expect(signedIn.why).toBe(doc.why);
    expect(signedIn.hiddenTies).toBeUndefined();
  });

  it("names nobody on a public finding who holds, held or stood for no office", () => {
    const budtest = docFor(BUDTEST);
    // A co-owner the research filed among the people with nothing to say
    // why: no candidacy, no mandate, no office.
    const coOwner: ContractLinkPerson = {
      name: "Jan Wspólnik",
      kind: "politician",
      roles: ["wspólnik"],
      controlNow: false,
      candidacies: [],
      wonYears: [],
      inOfficeNow: false,
      committees: [],
    };
    const doc = docFor(BUDTEST, { people: [...budtest.people, coOwner] });

    const anonymous = contractLinkItem(
      "cru_9990000011",
      doc,
      false,
    ) as ContractLinkRow;
    const wire = JSON.stringify(anonymous);
    expect(wire).not.toContain("Jan Wspólnik");
    expect(anonymous.people.map((person) => person.name)).toEqual([
      "Tomasz Testowy",
    ]);
    // Counted with the ties the card says are behind the login.
    expect(anonymous.hiddenTies).toBe(2);

    // On a finding with no ties, the research's sentence goes with them too.
    const handel = docFor(HANDEL);
    const withWhy = contractLinkItem(
      "cru_9990000022",
      docFor(HANDEL, {
        people: [...handel.people, coOwner],
        why: "Była radna gminy Testowo prowadzi firmę z Janem Wspólnikiem.",
      }),
      false,
    ) as ContractLinkRow;
    expect(withWhy.why).toBeUndefined();
    expect(withWhy.hiddenTies).toBe(1);

    // A signed-in reader is sent them as they are.
    expect(
      JSON.stringify(contractLinkItem("cru_9990000011", doc, true)),
    ).toContain("Jan Wspólnik");
  });

  it("sends a public finding with nobody left to name as a teaser", () => {
    const doc = docFor(HANDEL, {
      people: [
        {
          ...docFor(HANDEL).people[0]!,
          candidacies: [],
          wonYears: [],
        },
      ],
    });
    const item = contractLinkItem("cru_9990000022", doc, false);
    expect(item).toMatchObject({ id: "ukryte_3", locked: true });
    const wire = JSON.stringify(item);
    for (const secret of ["Barbara Próbna", "HANDEL-TEST", "9990000022"]) {
      expect(wire).not.toContain(secret);
    }
  });

  it("keeps `why` on a public finding with no ties to name", () => {
    const why = "Była radna gminy Testowo jest wspólniczką firmy.";
    const item = contractLinkItem(
      "cru_9990000022",
      docFor(HANDEL, { why }),
      false,
    ) as ContractLinkRow;
    expect(item.why).toBe(why);
    expect(item.hiddenTies).toBe(0);
  });

  it("sends a signed-in reader a gated finding in full", () => {
    const item = contractLinkItem("cru_9990000033", docFor(PRZYKLAD), true);
    expect(item.locked).toBe(false);
    expect(item.id).toBe("cru_9990000033");
    expect(JSON.stringify(item)).toContain("Marek Przykładowy");
  });
});

describe("toContractLinkDoc", () => {
  it("derives what it would otherwise have to trust", () => {
    const doc = docFor(BUDTEST);
    expect(doc.contractIds).toEqual([
      "cru_a1b2c3d400084aaa9bbb000000000008",
      "cru_a1b2c3d400094aaa9bbb000000000009",
    ]);
    expect(doc.topContract?.id).toBe("cru_a1b2c3d400084aaa9bbb000000000008");
    expect(doc.place).toEqual({
      wojewodztwo: "opolskie",
      powiat: "testowski",
      gmina: "Testowo",
    });
    // In the words `officeHook` gives a mandate - `tests/shared` pins them.
    expect(doc.hook).toBe(officeHook(doc.people[0]));
    expect(doc.hook).not.toBe("");
    expect(doc.updatedAt).toBe(NOW);
    expect("contractSourceIds" in doc).toBe(false);
    // No count from the pipeline: the list is taken to be every payer.
    expect(doc.buyerCount).toBe(2);
  });

  it("files a finding under its biggest payer, not the payer of its biggest contract", () => {
    const doc = docFor(DALEKO);
    expect(doc.topContract?.buyer.wojewodztwo).toBe("śląskie");
    expect(doc.place).toEqual({
      wojewodztwo: "małopolskie",
      powiat: "Kraków",
      gmina: "Kraków",
    });
    expect(doc.buyerCount).toBe(5);
  });

  it("falls back to the top contract's buyer when no payer is listed", () => {
    const doc = toContractLinkDoc(
      contractLinkPayloadSchema.parse({ ...payloadFor(BUDTEST), buyers: [] }),
      NOW,
    );
    expect(doc.place.wojewodztwo).toBe("opolskie");
    expect(doc.buyerCount).toBe(0);
  });

  it("never counts fewer payers than it lists", () => {
    const doc = toContractLinkDoc(
      contractLinkPayloadSchema.parse({ ...payloadFor(DALEKO), buyerCount: 1 }),
      NOW,
    );
    expect(doc.buyerCount).toBe(2);
  });

  it("gives a finding whose identity is in doubt the doubt for a hook, not the office", () => {
    const doc = docFor(DALEKO);
    expect(doc.people[0]!.office).toContain("radny");
    expect(doc.hook).toBe(UNCONFIRMED_IDENTITY_HOOK);
  });

  it("takes the hook from the first person with a public role", () => {
    const budtest = docFor(BUDTEST);
    const doc = toContractLinkDoc(
      contractLinkPayloadSchema.parse({
        ...payloadFor(BUDTEST),
        people: [
          {
            name: "Jan Wspólnik",
            kind: "politician",
            roles: ["wspólnik"],
            controlNow: true,
            inOfficeNow: false,
          },
          ...payloadFor(BUDTEST).people,
        ],
      }),
      NOW,
    );
    expect(doc.hook).toBe(budtest.hook);
  });

  it("drops a tie that is the person again, however it is spaced or cased", () => {
    const doc = docFor(DALEKO);
    expect(doc.ties.map((tie) => tie.name)).toEqual(["Krystyna Urzędnik"]);
  });

  it("stores no undefined values, which Firestore would refuse", () => {
    const walk = (value: unknown): boolean =>
      value === undefined
        ? false
        : Array.isArray(value)
          ? value.every(walk)
          : value && typeof value === "object"
            ? Object.values(value).every(walk)
            : true;
    for (const payload of payloads) {
      expect(walk(docFor(payload.nip))).toBe(true);
    }
  });

  it("refuses a payload with a malformed NIP or an unknown flag", () => {
    expect(() =>
      contractLinkPayloadSchema.parse({ ...payloadFor(BUDTEST), nip: "123" }),
    ).toThrow();
    expect(() =>
      contractLinkPayloadSchema.parse({
        ...payloadFor(BUDTEST),
        flags: ["corrupt"],
      }),
    ).toThrow();
  });
});

describe("the fixtures", () => {
  it("keep a finding's contracts out of the public contract fixtures", () => {
    const publicIds = new Set(publicContracts.map((entry) => entry.id_umowy));
    const behind = new Set(findingContracts.map((entry) => entry.id_umowy));
    const joined = payloads.flatMap((payload) => [
      ...payload.contractSourceIds,
      ...(payload.topContract ? [payload.topContract.sourceId] : []),
    ]);
    for (const id of joined.filter((id) => behind.has(id))) {
      expect(publicIds.has(id)).toBe(false);
    }
    // Every contract the public fixtures join, behind the gate.
    for (const id of payloads
      .filter((payload) => payload.visibility === "public")
      .flatMap((payload) => payload.contractSourceIds)) {
      expect(behind.has(id)).toBe(true);
    }
    expect(publicContracts).toHaveLength(7);
  });

  it("are ranked uniquely, strength first and then money", () => {
    const docs = payloads.map((payload) => docFor(payload.nip));
    const ranks = docs.map((doc) => doc.rank);
    expect(new Set(ranks).size).toBe(docs.length);
    const inRankOrder = [...docs].sort((a, b) => a.rank - b.rank);
    const expected = [...docs].sort(
      (a, b) => a.strength.localeCompare(b.strength) || b.total - a.total,
    );
    expect(inRankOrder.map((doc) => doc.nip)).toEqual(
      expected.map((doc) => doc.nip),
    );
  });
});

describe("computeContractLinkSummary", () => {
  it("counts and sums without a name in it", () => {
    const docs = payloads.map((payload) => docFor(payload.nip));
    const summary = computeContractLinkSummary(docs, NOW);

    expect(summary).toMatchObject({
      links: 5,
      verified: 3,
      public: 2,
      gated: 3,
      gatedVerified: 1,
      // Three findings have somebody in office; one of them may not be the
      // same person, and is not counted.
      inOfficeNow: 2,
      inOfficePeople: 2,
      total: 970000 + 64000 + 2400000 + 15000 + 5300000,
      totalVerified: 970000 + 64000 + 5300000,
      totalGated: 2400000 + 5300000 + 15000,
      byStrength: { A: 2, B: 1, C: 1, D: 1 },
      totalByStrength: {
        A: 970000 + 2400000,
        B: 64000,
        C: 5300000,
        D: 15000,
      },
    });
    expect(summary.byWojewodztwo.opolskie).toEqual({
      links: 2,
      total: 1034000,
      gated: 0,
    });
    expect(summary.byWojewodztwo.mazowieckie).toEqual({
      links: 1,
      total: 2400000,
      gated: 1,
    });
    expect(summary.from).toBe("2026-07-03");
    expect(summary.to).toBe("2026-09-02");
    const wire = JSON.stringify(summary);
    for (const name of ["Testowy", "Przykładowy", "Urzędnik", "BUDTEST"]) {
      expect(wire).not.toContain(name);
    }
  });

  it("counts a person in office once however many firms they are behind", () => {
    const budtest = docFor(BUDTEST);
    const again = docFor(HANDEL, {
      inOfficeNow: true,
      people: [{ ...budtest.people[0]!, name: " tomasz  testowy " }],
    });
    // And not at all a finding marked in office with nobody in office on it.
    const nobody = docFor(SPOLDZIELNIA, { inOfficeNow: true });

    const summary = computeContractLinkSummary([budtest, again, nobody], NOW);

    expect(summary.inOfficeNow).toBe(3);
    expect(summary.inOfficePeople).toBe(1);
  });

  it("claims nobody in office on a finding whose identity is in doubt", () => {
    const daleko = docFor(DALEKO);
    expect(daleko.people[0]!.inOfficeNow).toBe(true);
    const summary = computeContractLinkSummary([daleko], NOW);
    expect(summary.inOfficeNow).toBe(0);
    expect(summary.inOfficePeople).toBe(0);
    // Which the recount can only see if it reads the flags.
    expect(CONTRACT_LINK_SUMMARY_FIELDS).toContain("flags");
  });
});

describe("readContractLinkSummary", () => {
  function fakeDb(stored: Record<string, unknown> | undefined) {
    const set = vi.fn();
    const findings = payloads.map((payload) => docFor(payload.nip));
    const db = {
      collection: (name: string) =>
        name === "stats"
          ? {
              doc: () => ({
                get: async () => ({
                  exists: stored !== undefined,
                  data: () => stored,
                }),
                set,
              }),
            }
          : {
              select: () => ({
                get: async () => ({
                  docs: findings.map((finding) => ({ data: () => finding })),
                }),
              }),
            },
    };
    return {
      set,
      db: db as unknown as Parameters<typeof readContractLinkSummary>[0],
    };
  }

  it("recounts once a summary written before the fields the page reads", async () => {
    const { db, set } = fakeDb({ links: 5, total: 1, computedAt: NOW });
    const summary = await readContractLinkSummary(db);

    expect(summary).toMatchObject({ links: 5, gatedVerified: 1 });
    expect(summary?.totalByStrength.C).toBe(5300000);
    expect(set).toHaveBeenCalledOnce();
  });

  it("serves a current summary as it is", async () => {
    const current = computeContractLinkSummary(
      payloads.map((payload) => docFor(payload.nip)),
      NOW,
    );
    const { db, set } = fakeDb(current as unknown as Record<string, unknown>);

    expect(await readContractLinkSummary(db)).toEqual(current);
    expect(set).not.toHaveBeenCalled();
  });

  it("answers null when there is no summary at all", async () => {
    const { db } = fakeDb(undefined);
    expect(await readContractLinkSummary(db)).toBeNull();
  });
});

describe("cursors", () => {
  it("are the rank and nothing else, in both orders", () => {
    expect(encodeContractLinkCursor({ rank: 7 })).toBe("7");
    expect(parseContractLinkCursor("7")).toBe(7);
  });

  it("read anything that is not a rank as the first page", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "0",
      "-1",
      "1.5",
      "abc",
      "123456",
      // The shape the cursor had before it stopped carrying the NIP, and the
      // ones that made Firestore answer 500.
      "7|cru_9990000011",
      "1|a/b",
      "1|a/b/c",
      "1|__x__",
    ]) {
      expect(parseContractLinkCursor(raw)).toBeNull();
    }
  });
});

describe("buildContractLinkQuery", () => {
  /** Records the calls, which are what `firestore.indexes.json` has to match. */
  function recorder() {
    const calls: string[] = [];
    const query = {
      where: (field: string, op: string, value: unknown) => {
        calls.push(`where ${field} ${op} ${String(value)}`);
        return query;
      },
      orderBy: (field: string, direction: string) => {
        calls.push(`orderBy ${field} ${direction}`);
        return query;
      },
    };
    return {
      calls,
      db: { collection: () => query } as unknown as Parameters<
        typeof buildContractLinkQuery
      >[0],
    };
  }

  it("orders by rank alone, which is unique - no document id to break ties", () => {
    const { calls, db } = recorder();
    buildContractLinkQuery(db, { sort: "sila" });
    expect(calls).toEqual(["orderBy rank asc"]);
  });

  it("filters before ordering by money, then by rank", () => {
    const { calls, db } = recorder();
    buildContractLinkQuery(db, {
      sort: "kwota",
      verifiedOnly: true,
      wojewodztwo: "opolskie",
      strength: "A",
    });
    expect(calls).toEqual([
      "where status == verified",
      "where place.wojewodztwo == opolskie",
      "where strength == A",
      "orderBy total desc",
      "orderBy rank asc",
    ]);
  });

  it("has a composite index in firestore.indexes.json for every combination", () => {
    // At the repository root, beside firebase.json. `import.meta.url` is not a
    // file url under the Nuxt test environment, hence cwd.
    const path = existsSync(resolve(process.cwd(), "firestore.indexes.json"))
      ? resolve(process.cwd(), "firestore.indexes.json")
      : resolve(process.cwd(), "..", "firestore.indexes.json");
    const declared = (
      JSON.parse(readFileSync(path, "utf8")) as {
        indexes: {
          collectionGroup: string;
          fields: { fieldPath: string; order: string }[];
        }[];
      }
    ).indexes
      .filter((index) => index.collectionGroup === "contractLinks")
      .map((index) =>
        index.fields
          .map((field) => `${field.fieldPath} ${field.order}`)
          .join(", "),
      );

    const missing: string[] = [];
    for (const sort of ["sila", "kwota"] as ContractLinkSort[]) {
      for (const verifiedOnly of [false, true]) {
        for (const wojewodztwo of [undefined, "opolskie"]) {
          for (const strength of [undefined, "A"] as (
            ContractLinkStrength | undefined
          )[]) {
            const { calls, db } = recorder();
            buildContractLinkQuery(db, {
              sort,
              verifiedOnly,
              wojewodztwo,
              strength,
            });
            const fields = calls.map((call) => {
              const [kind, field, direction] = call.split(" ");
              return kind === "where"
                ? `${field} ASCENDING`
                : `${field} ${direction === "desc" ? "DESCENDING" : "ASCENDING"}`;
            });
            // One ordered field and nothing else is Firestore's own
            // single-field index.
            if (fields.length === 1) continue;
            const needed = fields.join(", ");
            if (!declared.includes(needed)) missing.push(needed);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
