import { describe, it, expect } from "vitest";
import {
  entityDescription,
  entityOgType,
  truncateDescription,
  type EntityNode,
} from "../../app/composables/entitySeo";
import type { EdgeNode } from "../../app/composables/edges";

function node(fields: Record<string, unknown>): EntityNode {
  return fields as unknown as EntityNode;
}

/** A row the way `useEdges` hands it over: the far end spread into `richNode`. */
function edge(
  fields: Record<string, unknown> & { richNode: Record<string, unknown> },
): EdgeNode {
  return {
    source: "a",
    target: "b",
    label: typeof fields.name === "string" ? fields.name : "",
    ...fields,
  } as unknown as EdgeNode;
}

const person = (name: string, parties?: string[]) => ({
  id: name,
  name,
  type: "person",
  parties,
});
const company = (name: string, extra: Record<string, unknown> = {}) => ({
  id: name,
  name,
  type: "place",
  ...extra,
});

describe("truncateDescription", () => {
  it("leaves a description that already fits alone", () => {
    expect(truncateDescription("Krótki opis", 40)).toBe("Krótki opis");
  });

  it("cuts on a word boundary and marks the cut", () => {
    expect(truncateDescription("jeden dwa trzy cztery", 16)).toBe(
      "jeden dwa trzy…",
    );
  });

  it("cuts mid-word rather than return almost nothing", () => {
    // An article headline can be one unbroken token; falling back to the last
    // space would leave an empty string.
    expect(truncateDescription("aaaaaaaaaaaaaaaaaaaa b", 10)).toBe(
      "aaaaaaaaa…",
    );
  });

  it("does not leave punctuation stranded before the ellipsis", () => {
    expect(truncateDescription("jeden dwa, trzy cztery", 15)).toBe(
      "jeden dwa…",
    );
  });
});

describe("entityDescription", () => {
  it("counts a person's relations, and declines the count", () => {
    expect(
      entityDescription(node({ type: "person", name: "Jan Kowalski" }), 2),
    ).toContain("2 powiązania");
    expect(
      entityDescription(node({ type: "person", name: "Jan Kowalski" }), 5),
    ).toContain("5 powiązań");
    expect(
      entityDescription(node({ type: "person", name: "Jan Kowalski" }), 1),
    ).toContain("1 powiązanie");
  });

  it("names the person's parties when it knows them", () => {
    const text = entityDescription(
      node({ type: "person", name: "Jan Kowalski", parties: ["PSL", "PiS"] }),
      3,
    );
    expect(text).toContain("Jan Kowalski (PSL, PiS)");
  });

  it("promises nothing about a page with no relations yet", () => {
    const text = entityDescription(
      node({ type: "person", name: "Jan Kowalski" }),
      0,
    );
    expect(text).not.toContain("0");
    expect(text).toContain("Jan Kowalski");
  });

  it("asks the question a company page answers", () => {
    expect(
      entityDescription(node({ type: "place", name: "Orlen S.A." }), 12),
    ).toContain("Kto pracuje i pracował w Orlen S.A.?");
  });

  it("describes a region by its name", () => {
    expect(
      entityDescription(node({ type: "region", name: "Kraków" }), 0),
    ).toContain("Kraków");
  });

  it("does not repeat the headline an article page already titles itself", () => {
    const headline = "Zarzuty wobec byłego dyrektora generalnego";
    expect(
      entityDescription(node({ type: "article", name: headline }), 4),
    ).not.toContain(headline);
  });

  it("stays inside what a link preview will show", () => {
    const longName = "Wojewódzki ".repeat(30);
    for (const type of ["person", "place", "region", "article"] as const) {
      const text = entityDescription(node({ type, name: longName }), 7);
      expect(text.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("entityDescription for a company, from its rows", () => {
  const bionanopark = node({ type: "place", name: "BIONANOPARK (Łódź)" });
  const bosakowski = edge({
    type: "employed",
    name: "Zarząd",
    start_date: "2026-08-28",
    richNode: person("Romuald Bosakowski", ["PO"]),
  });
  const fronczak = edge({
    type: "employed",
    name: "Rada Nadzorcza",
    start_date: "2004-01-12",
    end_date: "2008-05-16",
    richNode: person("Adam Fronczak", ["PSL"]),
  });

  it("names who holds the posts now and for which party, then who did", () => {
    // The page Google quoted as "Zarząd1 osoba. RB. Romuald BosakowskiPO."
    expect(entityDescription(bionanopark, 2, [fronczak, bosakowski])).toBe(
      "BIONANOPARK (Łódź). Zarząd: Romuald Bosakowski (PO), od 28 sierpnia 2026. Wcześniej: Adam Fronczak (PSL), Rada Nadzorcza 2004–2008.",
    );
  });

  it("puts the board before the supervisors, as Obecny skład does", () => {
    const seat = edge({
      type: "employed",
      name: "Rada Nadzorcza",
      start_date: "2027-01-01",
      richNode: person("Jan Nowak"),
    });
    const text = entityDescription(bionanopark, 2, [seat, bosakowski]);
    expect(text.indexOf("Zarząd:")).toBeLessThan(
      text.indexOf("Rada Nadzorcza:"),
    );
    // A person with no party is named as they are, with nothing after it.
    expect(text).toContain("Rada Nadzorcza: Jan Nowak, od 1 stycznia 2027.");
  });

  it("counts the people a long board leaves no room for", () => {
    const board = Array.from({ length: 9 }, (_, i) =>
      edge({
        type: "employed",
        name: "Rada Nadzorcza",
        start_date: `2020-01-0${i + 1}`,
        richNode: person(`Członkini Rady Numer ${i + 1}`, ["PiS"]),
      }),
    );
    const text = entityDescription(bionanopark, 9, board);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toMatch(/ i jeszcze \d+ os(oba|oby|ób)\.$/);
    // Newest appointment first, and no date for a list of several.
    expect(text).toContain("Rada Nadzorcza: Członkini Rady Numer 9 (PiS), ");
    expect(text).not.toContain(" od ");
  });

  it("says who used to hold a post when nobody holds one now", () => {
    expect(entityDescription(bionanopark, 1, [fronczak])).toBe(
      "BIONANOPARK (Łódź). Dawniej: Adam Fronczak (PSL), Rada Nadzorcza 2004–2008.",
    );
  });

  it("names somebody once however many spells they had", () => {
    const again = edge({
      ...fronczak,
      start_date: "2010-01-01",
      end_date: "2012-01-01",
    });
    const text = entityDescription(bionanopark, 2, [fronczak, again]);
    expect(text.match(/Adam Fronczak/g)).toHaveLength(1);
  });

  it("calls a hospital's supervisory seat by the organ's own name", () => {
    const hospital = node({
      type: "place",
      name: "SZPITAL MIEJSKI",
      supervisoryBody: "rada-spoleczna",
    });
    const seat = edge({
      type: "employed",
      name: "Rada Nadzorcza",
      richNode: person("Anna Kowalska", ["KO"]),
    });
    expect(entityDescription(hospital, 1, [seat])).toBe(
      "SZPITAL MIEJSKI. Rada Społeczna: Anna Kowalska (KO).",
    );
  });

  it("keeps a name the register broke across two lines on one", () => {
    const hospital = node({
      type: "place",
      name: "WOJEWÓDZKI SZPITAL SPECJALISTYCZNY \nNR 3 W RYBNIKU",
    });
    expect(entityDescription(hospital, 1, [bosakowski])).toMatch(
      /^WOJEWÓDZKI SZPITAL SPECJALISTYCZNY NR 3 W RYBNIKU\. Zarząd: /,
    );
  });

  it("dates a lone former post by what the register holds", () => {
    const leftOnly = edge({ ...fronczak, start_date: undefined });
    expect(entityDescription(bionanopark, 1, [leftOnly])).toContain(
      "Adam Fronczak (PSL), Rada Nadzorcza do 2008.",
    );
    const oneYear = edge({ ...fronczak, start_date: "2008-01-02" });
    expect(entityDescription(bionanopark, 1, [oneYear])).toContain(
      "Adam Fronczak (PSL), Rada Nadzorcza 2008.",
    );
  });

  it("does not end the company's name on two stops", () => {
    const orlen = node({ type: "place", name: "Orlen S.A." });
    expect(entityDescription(orlen, 1, [bosakowski])).toMatch(
      /^Orlen S\.A\. Zarząd: /,
    );
  });

  it("falls back to the question when no row names a person", () => {
    const owner = edge({
      type: "owns",
      richNode: { name: "Gmina Łódź", type: "region" },
    });
    expect(entityDescription(bionanopark, 1, [owner])).toContain(
      "Kto pracuje i pracował w BIONANOPARK (Łódź)?",
    );
  });
});

describe("entityDescription for a person, from their rows", () => {
  const bosakowski = node({
    type: "person",
    name: "Romuald Bosakowski",
    parties: ["PO"],
  });
  const now = edge({
    type: "employed",
    name: "Zarząd",
    start_date: "2026-08-28",
    richNode: company("BIONANOPARK (Łódź)"),
  });
  const fabryka = edge({
    type: "employed",
    name: "Rada Nadzorcza",
    start_date: "2025-09-04",
    end_date: "2026-03-18",
    richNode: company("FABRYKA PRZEWODÓW ENERGETYCZNYCH (Będzin)"),
  });
  const pkp = edge({
    type: "employed",
    name: "Zarząd",
    start_date: "2011-06-06",
    end_date: "2012-04-20",
    richNode: company("POLSKIE KOLEJE PAŃSTWOWE (Warszawa)"),
  });

  it("says where they hold a post now, then where they held one", () => {
    expect(entityDescription(bosakowski, 2, [pkp, now])).toBe(
      "Romuald Bosakowski (PO). Obecnie: Zarząd w BIONANOPARK (Łódź), od 28 sierpnia 2026. Wcześniej: POLSKIE KOLEJE PAŃSTWOWE (Warszawa), Zarząd 2011–2012.",
    );
  });

  it("counts the employers there is no room to name, latest first", () => {
    const text = entityDescription(bosakowski, 3, [pkp, fabryka, now]);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toContain(
      "Wcześniej: FABRYKA PRZEWODÓW ENERGETYCZNYCH (Będzin) i jeszcze 1 instytucja.",
    );
  });

  it("gives up the start date before it gives up a name", () => {
    const long = edge({
      ...now,
      richNode: company(
        "PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI W OKRĘGU PRZEMYSŁOWYM MIASTA STOŁECZNEGO",
      ),
    });
    const text = entityDescription(
      node({
        type: "person",
        name: "Jan Maria Rokita-Zawadzka",
        parties: ["PiS", "SLD", "PSL"],
      }),
      1,
      [long],
    );
    expect(text).toContain("MIASTA STOŁECZNEGO.");
    expect(text).not.toContain(" od ");
  });

  it("names where they stood for election, latest first", () => {
    const ballot = (where: string, day: string) =>
      edge({
        type: "election",
        name: "kandydatura",
        start_date: day,
        end_date: day,
        richNode: { name: where, type: "region" },
      });
    const text = entityDescription(
      node({
        type: "person",
        name: "Zdzisław Wolski",
        parties: ["Nowa Lewica"],
      }),
      3,
      [
        ballot("Częstochowa", "2002-10-27"),
        ballot("Łódź", "2010-06-20"),
        ballot("Częstochowa", "2006-11-12"),
      ],
    );
    expect(text).toBe(
      "Zdzisław Wolski (Nowa Lewica). Starty w wyborach: Łódź (2010), Częstochowa (2002, 2006).",
    );
  });

  it("keeps the stock sentence for somebody with nothing but acquaintances", () => {
    const friend = edge({
      type: "connection",
      name: "znajomy",
      richNode: person("Jan Nowak"),
    });
    expect(entityDescription(bosakowski, 1, [friend])).toContain(
      "w bazie koryciarstwa",
    );
  });
});

describe("entityOgType", () => {
  it("files each kind of page as what it is", () => {
    expect(entityOgType(node({ type: "article", name: "x" }))).toBe("article");
    expect(entityOgType(node({ type: "person", name: "x" }))).toBe("profile");
    expect(entityOgType(node({ type: "place", name: "x" }))).toBe("website");
    expect(entityOgType(node({ type: "region", name: "x" }))).toBe("website");
  });
});
