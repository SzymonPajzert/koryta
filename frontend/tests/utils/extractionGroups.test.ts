import { describe, it, expect } from "vitest";
import type { ExtractionFact } from "~~/shared/model";
import {
  factClaimKey,
  factGroupState,
  factGroupVoters,
  groupFacts,
  normalizeClaimField,
} from "~/utils/extraction";

/** „To prawda, ale chyba powinniśmy też mieć fakty jako rozkładalne elementy
 * (...) Wtedy możemy też je złączyć jeśli mamy ten sam fakt z różnych źródeł.”
 *
 * What counts as "the same fact" decides what a reader sees under one line, and
 * a wrong merge puts one article's quote under another article's claim. So
 * most of what is below is the near misses that must stay apart. */

let next = 0;

const NBSP = String.fromCodePoint(0xa0);

function fact(fields: Partial<ExtractionFact> = {}): ExtractionFact {
  next += 1;
  return {
    id: `fact-${next}`,
    url: `example.com/a${next}`,
    articleUrl: `example.com/a${next}`,
    articleDomain: "example.com",
    justification: "prezes Spółki Wodnej Anna Nowak",
    fact_type: "employment",
    person: "Anna Nowak",
    organization: "Spółka Wodna",
    role: "prezes zarządu",
    personNodeId: "anna",
    personNodeName: "Anna Nowak",
    tag: "v26",
    ...fields,
  };
}

/** The claims `groupFacts` makes of these facts, as the ids in each. */
function claims(...facts: ExtractionFact[]): string[][] {
  return groupFacts(facts).map((group) =>
    group.sources.flatMap((source) => [
      source.fact.id!,
      ...source.twins.map((twin) => twin.id!),
    ]),
  );
}

const voted = (correct: number, voters = 1): Partial<ExtractionFact> => ({
  stats: {
    votes: { correct, humanVoted: true, humanCount: voters },
  } as ExtractionFact["stats"],
});

describe("groupFacts", () => {
  it("makes one line of one claim read in two articles, newest article first", () => {
    const newer = fact({ articleUrl: "tvn24.pl/a", articleDomain: "tvn24.pl" });
    const older = fact({ articleUrl: "rmf24.pl/b", articleDomain: "rmf24.pl" });

    const [group, ...rest] = groupFacts([newer, older]);

    expect(rest).toHaveLength(0);
    expect(group!.sources.map((source) => source.fact.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(group!.fact).toBe(newer);
  });

  it("keeps claims in the order their newest facts came in", () => {
    const a = fact({ organization: "Spółka A" });
    const b = fact({ organization: "Spółka B" });
    const aAgain = fact({ organization: "Spółka A" });

    expect(claims(a, b, aAgain)).toEqual([[a.id, aAgain.id], [b.id]]);
  });

  it("reads past typography two articles differ in", () => {
    // All from the 29 September export: the same claim, spelled differently.
    const pairs: [Partial<ExtractionFact>, Partial<ExtractionFact>][] = [
      [
        { fact_type: "party_membership", party: "PSL-Kukiz15" },
        { fact_type: "party_membership", party: "PSL - Kukiz'15" },
      ],
      [
        { fact_type: "party_membership", party: "PSL Kukiz’15" },
        { fact_type: "party_membership", party: "psl-kukiz15" },
      ],
      [
        {
          fact_type: "party_membership",
          party: "Koalicja Obywatelska - PO i Nowoczesna",
        },
        {
          fact_type: "party_membership",
          party: "Koalicja Obywatelska PO i Nowoczesna",
        },
      ],
      [
        { organization: 'Ruch Samorządowy "Tak! Dla Polski' },
        { organization: "Ruch Samorządowy „Tak! Dla Polski”" },
      ],
      [
        { organization: "Szpital Wojewódzki w Gorzowie Wlkp.", role: "prezes" },
        { organization: "Szpital Wojewódzki w Gorzowie Wlkp", role: "prezes" },
      ],
      [
        { organization: "KPP w Trzebnicy", role: "asp. sztab." },
        { organization: "KPP  w Trzebnicy", role: "asp. sztab" },
      ],
      [
        // A no-break space, as a page's html often has between two words.
        { organization: `Spółka${NBSP}Wodna`, role: "Prezes Zarządu" },
        { organization: "spółka wodna", role: "prezes zarządu" },
      ],
    ];

    for (const [left, right] of pairs) {
      expect(claims(fact(left), fact(right))).toHaveLength(1);
    }
  });

  describe("keeps apart what only looks alike", () => {
    it("two roles in one company", () => {
      expect(
        claims(fact({ role: "prezes" }), fact({ role: "wiceprezes" })),
      ).toHaveLength(2);
    });

    it("a role and no role", () => {
      // „Rząd” and „Rząd, członek rządu” - the second says more.
      expect(
        claims(
          fact({ organization: "Rząd", role: undefined }),
          fact({ organization: "Rząd", role: "członek rządu" }),
        ),
      ).toHaveLength(2);
    });

    it("the same words about two people", () => {
      expect(
        claims(fact({ personNodeId: "anna" }), fact({ personNodeId: "jan" })),
      ).toHaveLength(2);
    });

    it("the same words where nobody was matched", () => {
      // Two namesakes as easily as one person: nothing says who either is.
      expect(
        claims(
          fact({ personNodeId: undefined }),
          fact({ personNodeId: undefined }),
        ),
      ).toHaveLength(2);
    });

    it("two kinds of fact naming one organization", () => {
      // „szef PSL” as a job and „PSL” as a party are two facts.
      expect(
        claims(
          fact({ organization: "PSL", role: "" }),
          fact({
            fact_type: "party_membership",
            party: "PSL",
            organization: undefined,
            role: undefined,
          }),
        ),
      ).toHaveLength(2);
    });

    it("spellings that differ in their diacritics", () => {
      expect(
        claims(
          fact({ organization: "Urząd Miasta Kraśnik" }),
          fact({ organization: "Urząd Miasta Krasnik" }),
        ),
      ).toHaveLength(2);
    });

    it("one office under two names", () => {
      // Very likely the same office, but saying so is a reader's call.
      expect(
        claims(
          fact({ organization: "Urząd m.st. Warszawy", role: "prezydent" }),
          fact({
            organization: "Urząd Miasta Stołecznego Warszawa",
            role: "prezydent",
          }),
        ),
      ).toHaveLength(2);
    });

    it("a relation to one person said two ways", () => {
      const relation = {
        fact_type: "personal_relation" as const,
        subject: "Anna Nowak",
        object: "Piotr Nowak",
        organization: undefined,
        role: undefined,
      };
      expect(
        claims(
          fact({ ...relation, relation: "brat" }),
          fact({ ...relation, relation: "przyrodni brat" }),
        ),
      ).toHaveLength(2);
      expect(
        claims(
          fact({ ...relation, relation: "brat" }),
          fact({ ...relation, object: "Paweł Nowak", relation: "brat" }),
        ),
      ).toHaveLength(2);
    });

    it("two roles in one affair", () => {
      const affair = {
        fact_type: "affair_involvement" as const,
        affair: "Afera Testowa",
        organization: undefined,
      };
      expect(
        claims(
          fact({ ...affair, role: "uczestnik" }),
          fact({ ...affair, role: "oskarżony" }),
        ),
      ).toHaveLength(2);
    });

    it("facts that do not say what they are about", () => {
      // „prezes” of two unnamed companies is not one claim.
      expect(
        claims(fact({ organization: undefined }), fact({ organization: "  " })),
      ).toHaveLength(2);
    });
  });

  describe("one article read twice", () => {
    it("is one source, whatever form its url was stored in", () => {
      const first = fact({ articleUrl: "https://tvn24.pl/polska/a/" });
      const second = fact({ articleUrl: "tvn24.pl/polska/a" });

      const [group] = groupFacts([first, second]);

      expect(group!.sources).toHaveLength(1);
      expect(group!.sources[0]!.twins).toEqual([second]);
    });

    it("is shown through the extraction readers judged", () => {
      // A reader's verdict is the one thing the line has to show, and it may
      // be on either copy: the review queue handed out both.
      const unjudged = fact({ articleUrl: "tvn24.pl/a" });
      const judged = fact({ articleUrl: "tvn24.pl/a", ...voted(1) });

      const [group] = groupFacts([unjudged, judged]);

      expect(group!.sources[0]!.fact).toBe(judged);
      expect(group!.sources[0]!.twins).toEqual([unjudged]);
    });

    it("and otherwise through the newest", () => {
      const newer = fact({ articleUrl: "tvn24.pl/a" });
      const older = fact({ articleUrl: "tvn24.pl/a" });

      expect(groupFacts([newer, older])[0]!.sources[0]!.fact).toBe(newer);
    });
  });

  it("gives every line a key of its own", () => {
    const groups = groupFacts([
      fact(),
      fact({ organization: "Inna Spółka" }),
      fact({ personNodeId: undefined }),
      fact({ personNodeId: undefined }),
    ]);

    expect(new Set(groups.map((group) => group.key)).size).toBe(4);
  });
});

describe("factClaimKey", () => {
  it("says nothing for a fact that stands on its own", () => {
    expect(factClaimKey(fact({ personNodeId: undefined }))).toBeUndefined();
    expect(factClaimKey(fact({ organization: "" }))).toBeUndefined();
  });
});

describe("normalizeClaimField", () => {
  it("leaves the words alone", () => {
    expect(normalizeClaimField("Urząd m.st. Warszawy")).toBe(
      "urząd m.st. warszawy",
    );
  });

  it("copes with a field the model left out", () => {
    expect(normalizeClaimField(undefined)).toBe("");
    expect(normalizeClaimField(null)).toBe("");
  });
});

describe("where a claim stands", () => {
  const twoArticles = (...states: Partial<ExtractionFact>[]) =>
    groupFacts(
      states.map((extra, index) =>
        fact({ articleUrl: `example.com/${index}`, ...extra }),
      ),
    )[0]!;

  it("is confirmed once one article's quote is, while nobody disputes it", () => {
    expect(factGroupState(twoArticles(voted(1), {}))).toBe("confirmed");
  });

  it("settles nothing when one article is confirmed and another rejected", () => {
    // Two readers disagreeing about the claim: „Niepoprawny fakt” says the
    // fact is wrong, not that its article is thin. „Bez rozstrzygnięcia”, as
    // one fact whose votes net to zero.
    expect(factGroupState(twoArticles(voted(1), voted(-1)))).toBe("unreviewed");
    const flagged: Partial<ExtractionFact> = {
      stats: {
        votes: { wrongPerson: 1, humanVoted: true, humanCount: 1 },
      } as ExtractionFact["stats"],
    };
    expect(factGroupState(twoArticles(voted(2, 2), flagged))).toBe(
      "unreviewed",
    );
  });

  it("stays open while any article is unjudged", () => {
    expect(factGroupState(twoArticles({}, voted(-1)))).toBe("unreviewed");
  });

  it("is disputed only once every article is", () => {
    expect(factGroupState(twoArticles(voted(-1), voted(-2, 2)))).toBe(
      "disputed",
    );
    const flagged: Partial<ExtractionFact> = {
      stats: {
        votes: { wrongPerson: 1, humanVoted: true, humanCount: 1 },
      } as ExtractionFact["stats"],
    };
    expect(factGroupState(twoArticles(flagged, voted(-1)))).toBe("disputed");
  });

  it("counts the voters across its articles", () => {
    expect(factGroupVoters(twoArticles(voted(1, 2), voted(-1), {}))).toBe(3);
  });
});
