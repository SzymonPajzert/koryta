import { describe, it, expect } from "vitest";
import {
  FACT_NAME_QUERY,
  FACT_SECTION_ID,
  factNameCaption,
  factNamePick,
  factNamesBesides,
  omniSearchTarget,
} from "../../app/composables/omniSearch";
import type { FactNameHit } from "../../shared/factNames";

describe("omniSearchTarget", () => {
  // A profile opened from the revision queue carries `?revisionId=`, and the
  // view renders that revision on top of the node. A search made from there has
  // to leave it behind, or the next profile shows the previous person's
  // proposal and the search looks like it never navigated.
  it("drops the current query when the pick leads to another page", () => {
    expect(
      omniSearchTarget(
        { path: "/osoba/jan-kowalski-1", query: { revisionId: "rev1" } },
        { path: "/osoba/anna-nowak-2" },
      ),
    ).toEqual({ path: "/osoba/anna-nowak-2", query: {} });
  });

  it("keeps the current query when the pick refines the same page", () => {
    expect(
      omniSearchTarget(
        { path: "/eksploruj/tabela", query: { miejsce: "krakow" } },
        { path: "/eksploruj/tabela", query: { party: "PiS" } },
      ),
    ).toEqual({
      path: "/eksploruj/tabela",
      query: { miejsce: "krakow", party: "PiS" },
    });
  });

  it("stays put, filters and all, for a pick with no path of its own", () => {
    expect(
      omniSearchTarget(
        { path: "/graf", query: { partia: "PiS" } },
        { query: { miejsce: "krakow" } },
      ),
    ).toEqual({ path: "/graf", query: { partia: "PiS", miejsce: "krakow" } });
  });

  it("sends a pick the site cannot show to the table", () => {
    expect(
      omniSearchTarget(
        { path: "/admin/rewizje/node1", query: { revisionId: "rev1" } },
        { path: "/admin/rewizje/node2" },
      ),
    ).toEqual({ path: "/eksploruj/tabela", query: {} });
  });
});

/** A name only the article facts carry - the report's Piotr Ferster. */
function hit(fields: Partial<FactNameHit> = {}): FactNameHit {
  return {
    name: "Piotr Ferster",
    facts: 3,
    people: [{ id: "8rg6", name: "Rafał Trzaskowski", facts: 3 }],
    morePeople: 0,
    articles: [],
    moreArticles: 0,
    ...fields,
  };
}

const ARTICLE = { url: "rmf24.pl/wybory", domain: "rmf24.pl", facts: 1 };

describe("factNamePick", () => {
  it("opens the page whose facts name them, at those facts and only them", () => {
    const pick = factNamePick(hit());
    expect(pick).toEqual({
      path: "/osoba/rafal-trzaskowski-8rg6",
      query: { [FACT_NAME_QUERY]: "Piotr Ferster" },
      hash: `#${FACT_SECTION_ID}`,
    });
    // And the search box lets it through, rather than sending it to the table.
    expect(omniSearchTarget({ path: "/", query: {} }, pick)).toEqual({
      path: "/osoba/rafal-trzaskowski-8rg6",
      query: { fakty: "Piotr Ferster" },
      hash: "#fakty",
    });
  });

  it("keeps a section only on the page it belongs to", () => {
    // Sent to the table instead, the pick must not take `#fakty` along.
    expect(
      omniSearchTarget(
        { path: "/", query: {} },
        { path: "/admin/rewizje/node2", hash: "#fakty" },
      ),
    ).toEqual({ path: "/eksploruj/tabela", query: {} });
  });

  it("opens the article's facts where no page carries them", () => {
    const pick = factNamePick(hit({ people: [], articles: [ARTICLE] }));
    expect(pick).toEqual({
      path: "/ekstrakcje",
      query: { article: "rmf24.pl/wybory" },
    });
    expect(omniSearchTarget({ path: "/", query: {} }, pick)).toEqual({
      path: "/ekstrakcje",
      query: { article: "rmf24.pl/wybory" },
    });
  });
});

describe("factNameCaption", () => {
  it("says whose facts name them", () => {
    expect(factNameCaption(hit())).toBe("W faktach o: Rafał Trzaskowski");
    expect(factNameCaption(hit({ facts: 1 }))).toBe(
      "W fakcie o: Rafał Trzaskowski",
    );
  });

  it("names two people and counts the rest", () => {
    const people = [
      { id: "a", name: "Anna Nowak", facts: 2 },
      { id: "b", name: "Jan Kowalski", facts: 1 },
    ];
    expect(factNameCaption(hit({ people }))).toBe(
      "W faktach o: Anna Nowak, Jan Kowalski",
    );
    expect(factNameCaption(hit({ people, morePeople: 1 }))).toBe(
      "W faktach 3 osób, m.in.: Anna Nowak, Jan Kowalski",
    );
    expect(factNameCaption(hit({ people, morePeople: 3 }))).toBe(
      "W faktach 5 osób, m.in.: Anna Nowak, Jan Kowalski",
    );
  });

  it("names the article where no page carries them", () => {
    expect(
      factNameCaption(hit({ facts: 1, people: [], articles: [ARTICLE] })),
    ).toBe("W fakcie z artykułu: rmf24.pl");
    expect(
      factNameCaption(
        hit({
          people: [],
          articles: [ARTICLE, { ...ARTICLE, domain: "tvn24.pl" }],
          moreArticles: 2,
        }),
      ),
    ).toBe("W faktach z 4 artykułów, m.in.: rmf24.pl, tvn24.pl");
  });

  it("names a site once, however many of its articles name them", () => {
    // Eva Kaili, on the 2026-09-29 export: every fact from bankier.pl.
    expect(
      factNameCaption(
        hit({
          name: "Eva Kaili",
          facts: 19,
          people: [],
          articles: [
            { url: "bankier.pl/a", domain: "bankier.pl", facts: 10 },
            { url: "bankier.pl/b", domain: "bankier.pl", facts: 9 },
          ],
        }),
      ),
    ).toBe("W faktach z 2 artykułów: bankier.pl");
  });
});

describe("factNamesBesides", () => {
  it("drops a name the people search found a page for", () => {
    // Added since the server last read the graph: the page is a row of its
    // own already, however the facts spell the name.
    expect(
      factNamesBesides(
        [hit(), hit({ name: "Żaneta Wspomniana" })],
        ["FERSTER PIOTR"],
      ).map((h) => h.name),
    ).toEqual(["Żaneta Wspomniana"]);
  });

  it("keeps every name when no page answers it", () => {
    expect(factNamesBesides([hit()], ["Piotr Fersterski"])).toHaveLength(1);
  });
});
