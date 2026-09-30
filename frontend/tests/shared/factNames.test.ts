import { describe, it, expect } from "vitest";
import {
  buildFactNameIndex,
  candidateSpellings,
  factNameKey,
  factNamesPerson,
  isSearchableName,
  searchFactNames,
  toFactNameHit,
  unmatchedNames,
  type FactNameSource,
} from "~~/shared/factNames";

/** A fact as the index reads it: the other person in a relation on the page
 * of the person it is about - the report's own case, Piotr Ferster on Rafał
 * Trzaskowski's page. */
function relation(fields: Partial<FactNameSource> = {}): FactNameSource {
  return {
    fact_type: "personal_relation",
    subject: "Rafał Trzaskowski",
    object: "Piotr Ferster",
    personNodeId: "trzaskowski",
    personNodeName: "Rafał Trzaskowski",
    articleUrl: "rmf24.pl/wybory",
    articleDomain: "rmf24.pl",
    ...fields,
  };
}

/** A fact whose subject matched nobody - an article about somebody the graph
 * does not have. */
function unmatched(fields: Partial<FactNameSource> = {}): FactNameSource {
  return {
    fact_type: "employment",
    person: "Zbigniew Ziobro",
    articleUrl: "https://www.tvn24.pl/fundusz",
    articleDomain: "tvn24.pl",
    ...fields,
  };
}

describe("isSearchableName", () => {
  it("takes a full name, however it is written", () => {
    expect(isSearchableName("Piotr Ferster")).toBe(true);
    expect(isSearchableName("Urszula Brzezińska-Hołownia")).toBe(true);
    expect(isSearchableName("Pier Antonio Panzeri")).toBe(true);
    expect(isSearchableName("Viktor Orbán")).toBe(true);
    expect(isSearchableName("Ursula von der Leyen")).toBe(true);
    expect(isSearchableName("Szymon Ł. Różański")).toBe(true);
    // As a register prints it.
    expect(isSearchableName("TOMASZ PAWLAK")).toBe(true);
  });

  it("turns away an initial for a surname", () => {
    // The press anonymises a suspect this way, and one entry would pool every
    // Tomasz S. in every article into a person who does not exist.
    expect(isSearchableName("Tomasz S.")).toBe(false);
    expect(isSearchableName("Radosław Sz.")).toBe(false);
    expect(isSearchableName("Renata L.–G.")).toBe(false);
  });

  it("turns away a relation or a role standing in for a name", () => {
    expect(isSearchableName("żona Marcina Liberackiego")).toBe(false);
    expect(isSearchableName("prezes")).toBe(false);
    expect(isSearchableName("posłowie PSL")).toBe(false);
    expect(isSearchableName("dr hab. Marek Leśniak")).toBe(false);
    expect(isSearchableName("Jarosław Wenderlich senior")).toBe(false);
  });

  it("turns away a first name alone, and nothing at all", () => {
    expect(isSearchableName("Anna")).toBe(false);
    expect(isSearchableName("")).toBe(false);
    expect(isSearchableName(undefined)).toBe(false);
  });

  it("does not let a particle open or close a name", () => {
    expect(isSearchableName("von Leyen")).toBe(false);
    expect(isSearchableName("Ursula von")).toBe(false);
  });
});

describe("factNameKey", () => {
  it("folds case and Polish diacritics, ł included", () => {
    expect(factNameKey("Łukasz Żuk")).toBe(factNameKey("LUKASZ ZUK"));
    expect(factNameKey("Żaneta Wspomniana")).toBe("wspomniana zaneta");
  });

  it("takes a name in either order", () => {
    // A list that prints the surname first is the same person.
    expect(factNameKey("Ferster Piotr")).toBe(factNameKey("Piotr Ferster"));
  });

  it("reads a hyphen as a break between words", () => {
    expect(factNameKey("Anna Kowalska-Nowak")).toBe(
      factNameKey("Anna Kowalska Nowak"),
    );
  });

  it("keeps different people apart", () => {
    expect(factNameKey("Piotr Ferster")).not.toBe(
      factNameKey("Andrzej Ferster"),
    );
  });
});

describe("unmatchedNames", () => {
  it("names the other person in a relation, whose subject has a page", () => {
    expect(unmatchedNames(relation())).toEqual(["Piotr Ferster"]);
  });

  it("names the subject too, where it matched nobody", () => {
    expect(
      unmatchedNames(
        relation({
          subject: "Stanisław Gawłowski",
          object: "Anna Gawłowska",
          personNodeId: undefined,
          personNodeName: undefined,
        }),
      ),
    ).toEqual(["Anna Gawłowska", "Stanisław Gawłowski"]);
    expect(unmatchedNames(unmatched())).toEqual(["Zbigniew Ziobro"]);
  });

  it("leaves out a subject that was matched to a page", () => {
    expect(
      unmatchedNames(
        unmatched({
          personNodeId: "ziobro",
          personNodeName: "Zbigniew Ziobro",
        }),
      ),
    ).toEqual([]);
  });

  it("leaves out what is not a full name", () => {
    expect(unmatchedNames(relation({ object: "żona" }))).toEqual([]);
    expect(unmatchedNames(unmatched({ person: "Konrad R." }))).toEqual([]);
  });
});

describe("factNamesPerson", () => {
  it("finds the name in any slot, spelled any way", () => {
    const key = factNameKey("PIOTR FERSTER");
    expect(factNamesPerson(relation(), key)).toBe(true);
    expect(factNamesPerson(relation({ object: "Ferster Piotr" }), key)).toBe(
      true,
    );
    expect(factNamesPerson(relation({ object: "Anna Ferster" }), key)).toBe(
      false,
    );
  });

  it("finds nothing for an empty key", () => {
    expect(factNamesPerson(relation(), "")).toBe(false);
  });
});

describe("buildFactNameIndex", () => {
  it("pools the facts naming one person and says where they are", () => {
    const index = buildFactNameIndex([
      relation(),
      relation({
        articleUrl: "warszawa.naszemiasto.pl/a",
        object: "Piotr Ferster",
      }),
      relation({ object: "PIOTR FERSTER" }),
    ]);

    expect(index).toHaveLength(1);
    const [ferster] = index;
    expect(ferster!.facts).toBe(3);
    // The spelling most facts use.
    expect(ferster!.name).toBe("Piotr Ferster");
    expect(ferster!.people).toEqual([
      { id: "trzaskowski", name: "Rafał Trzaskowski", facts: 3 },
    ]);
    expect(ferster!.articles).toEqual([]);
  });

  it("puts a fact that matched nobody on its article", () => {
    const [ziobro] = buildFactNameIndex([unmatched()]);
    expect(ziobro!.people).toEqual([]);
    expect(ziobro!.articles).toEqual([
      { url: "https://www.tvn24.pl/fundusz", domain: "tvn24.pl", facts: 1 },
    ]);
  });

  it("reads the domain off the url where the fact carries none", () => {
    const [ziobro] = buildFactNameIndex([
      unmatched({ articleDomain: undefined }),
    ]);
    expect(ziobro!.articles[0]!.domain).toBe("tvn24.pl");
  });

  it("orders the places by how many facts put the name there", () => {
    const [ferster] = buildFactNameIndex([
      relation({ personNodeId: "a", personNodeName: "Anna Nowak" }),
      relation({ personNodeId: "b", personNodeName: "Beata Kowal" }),
      relation({ personNodeId: "b", personNodeName: "Beata Kowal" }),
    ]);
    expect(ferster!.people.map((person) => person.id)).toEqual(["b", "a"]);
  });

  it("leaves out a name somebody has a page under", () => {
    const index = buildFactNameIndex(
      [relation(), unmatched()],
      new Set([factNameKey("Zbigniew Ziobro")]),
    );
    expect(index.map((entry) => entry.name)).toEqual(["Piotr Ferster"]);
  });

  it("leaves out a name the ingest matched to a page elsewhere", () => {
    // A later article that left Trzaskowski unmatched does not make him
    // somebody without a page.
    const index = buildFactNameIndex([
      relation(),
      unmatched({ person: "Rafał Trzaskowski" }),
    ]);
    expect(index.map((entry) => entry.name)).toEqual(["Piotr Ferster"]);
  });

  it("links a page under its current name, and a gone one not at all", () => {
    const renamed = buildFactNameIndex(
      [relation()],
      new Set(),
      new Map([["trzaskowski", "Rafał Kazimierz Trzaskowski"]]),
    );
    expect(renamed[0]!.people[0]!.name).toBe("Rafał Kazimierz Trzaskowski");

    // Removed or merged away: the article is where the fact still is.
    const gone = buildFactNameIndex(
      [relation()],
      new Set(),
      new Map([["trzaskowski", null]]),
    );
    expect(gone[0]!.people).toEqual([]);
    expect(gone[0]!.articles).toEqual([
      { url: "rmf24.pl/wybory", domain: "rmf24.pl", facts: 1 },
    ]);
  });

  it("prefers the spelling with its diacritics on a tie", () => {
    const [entry] = buildFactNameIndex([
      relation({ object: "Zaneta Wspomniana" }),
      relation({ object: "Żaneta Wspomniana" }),
    ]);
    expect(entry!.name).toBe("Żaneta Wspomniana");
  });
});

describe("candidateSpellings", () => {
  it("lists every spelling once, for checking against the graph", () => {
    expect(
      candidateSpellings([
        relation(),
        relation({ object: "PIOTR FERSTER" }),
        relation(),
      ]),
    ).toEqual(["Piotr Ferster", "PIOTR FERSTER"]);
  });
});

describe("searchFactNames", () => {
  const index = buildFactNameIndex([
    relation(),
    relation(),
    relation({ object: "Żaneta Wspomniana" }),
    relation({ object: "Andrzej Ferster" }),
    unmatched(),
  ]);
  const names = (query: string, limit = 10) =>
    searchFactNames(index, query, limit).map((entry) => entry.name);

  it("finds a name without its diacritics, in any case", () => {
    expect(names("zaneta wspomniana")).toEqual(["Żaneta Wspomniana"]);
    expect(names("ŻANETA")).toEqual(["Żaneta Wspomniana"]);
  });

  it("finds a name typed surname first, or by the start of each word", () => {
    expect(names("Ferster Piotr")).toEqual(["Piotr Ferster"]);
    expect(names("pio fers")).toEqual(["Piotr Ferster"]);
  });

  it("puts the names the facts mention most first", () => {
    expect(names("ferster")).toEqual(["Piotr Ferster", "Andrzej Ferster"]);
  });

  it("puts a name the query starts ahead of one it only matches", () => {
    // Fersterski is mentioned twice as often, but "ferster" is the start of
    // the other name as written - what somebody typing it is most likely
    // after.
    const listed = buildFactNameIndex([
      relation({ object: "Ferster Andrzej" }),
      relation({ object: "Andrzej Fersterski" }),
      relation({ object: "Andrzej Fersterski" }),
    ]);
    expect(
      searchFactNames(listed, "ferster", 10).map((entry) => entry.name),
    ).toEqual(["Ferster Andrzej", "Andrzej Fersterski"]);
  });

  it("stops at the limit", () => {
    expect(names("ferster", 1)).toEqual(["Piotr Ferster"]);
  });

  it("answers nothing to nothing", () => {
    expect(names("")).toEqual([]);
    expect(names(" - ")).toEqual([]);
  });
});

describe("toFactNameHit", () => {
  it("names two places and counts the rest", () => {
    const [entry] = buildFactNameIndex([
      relation({ personNodeId: "a", personNodeName: "Anna Nowak" }),
      relation({ personNodeId: "b", personNodeName: "Beata Kowal" }),
      relation({ personNodeId: "c", personNodeName: "Celina Mak" }),
    ]);
    const hit = toFactNameHit(entry!);
    expect(hit.people).toHaveLength(2);
    expect(hit.morePeople).toBe(1);
    expect(hit.moreArticles).toBe(0);
  });
});
