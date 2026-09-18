import { describe, it, expect } from "vitest";
import {
  baseAsOfLabel,
  companyCardProps,
  personCardProps,
} from "../../app/composables/ogCard";
import type { EdgeNode } from "../../app/composables/edges";
import type { Company, Person } from "../../shared/model";

/** A fixed clock, so nothing here moves with the calendar. */
const NOW = new Date("2026-09-18T00:00:00Z");

function person(fields: Record<string, unknown> = {}): Person {
  return {
    type: "person",
    name: "Jan Kowalski",
    ...fields,
  } as unknown as Person;
}

function company(fields: Record<string, unknown> = {}): Company {
  return { type: "place", name: "ENEA", ...fields } as unknown as Company;
}

/** An edge as `useEdges` hands it over: `label` already fallen back to the edge
 * type's phrase, which is exactly the trap the card must not print. */
function edge(fields: Record<string, unknown>): EdgeNode {
  const type = (fields.type as string | undefined) ?? "employed";
  const labels: Record<string, string> = {
    employed: "Zatrudniony/a w",
    election: "Kandydował/a w",
    owns: "Właściciel",
  };
  return {
    type,
    label: (fields.name as string) || labels[type] || type,
    source: "src",
    target: "tgt",
    richNode: { type: "place", name: "Instytucja" },
    ...fields,
  } as unknown as EdgeNode;
}

const place = (name: string, extra: Record<string, unknown> = {}) => ({
  type: "place",
  name,
  ...extra,
});

describe("baseAsOfLabel", () => {
  it("stamps the month and year, not the day", () => {
    // A day would mint a new image URL - and a new render - every night, for
    // every page on the site.
    expect(baseAsOfLabel(NOW)).toBe("wrzesień 2026");
    expect(baseAsOfLabel(new Date("2027-01-02T00:00:00Z"))).toBe(
      "styczeń 2027",
    );
  });
});

describe("personCardProps", () => {
  it("leads with a current public-sector seat", () => {
    const e = edge({
      name: "Rada Nadzorcza",
      target: "enea",
      richNode: place("ENEA", { isPublic: true }),
      start_date: "2024-01-01",
    });
    const props = personCardProps({
      person: person({ parties: ["PiS"] }),
      targets: [e],
      edges: [e],
      now: NOW,
    });
    expect(props.eyebrow).toBe("OSOBA");
    expect(props.fact).toBe("Obecnie: Rada Nadzorcza · ENEA");
    expect(props.chipLabel).toBe("partia w bazie: PiS");
    expect(props.stat1Value).toBe("1");
    expect(props.stat1Label).toBe("obecna posada");
  });

  it("treats an edge with any end date as finished", () => {
    // The crawl stamps an end date the moment a post stops appearing in the
    // register - 205 posts share the single date below - so a laxer test would
    // print "Obecnie" for a seat the page itself draws as over.
    const e = edge({
      name: "Zarząd",
      richNode: place("PKP", { isPublic: true }),
      start_date: "2019-01-01",
      end_date: "2026-03-18",
    });
    const props = personCardProps({
      person: person(),
      targets: [e],
      edges: [e],
      now: NOW,
    });
    expect(props.fact).toBe("Ostatnia funkcja: Zarząd · PKP, do 2026");
    expect(props.stat1Label).toBe("instytucja publiczna");
  });

  it("never prints the edge-type phrase as if it were a job title", () => {
    // `useEdges` falls `label` back to "Zatrudniony/a w"; reading it instead of
    // `name` would put that on the card as a role.
    const e = edge({
      name: "",
      richNode: place("ENEA", { isPublic: true }),
    });
    const props = personCardProps({
      person: person(),
      targets: [e],
      edges: [e],
      now: NOW,
    });
    expect(props.fact).toBe("Obecnie: ENEA");
    expect(props.fact).not.toContain("Zatrudniony");
  });

  it("rewrites a stored Rada Nadzorcza to the body the institution has", () => {
    // An SPZOZ's rada społeczna is created by statute and is not a paid
    // supervisory board. Printing the stored string asserts one that does not
    // exist.
    const e = edge({
      name: "Rada Nadzorcza",
      richNode: place("SPZOZ", {
        isPublic: true,
        supervisoryBody: "rada-spoleczna",
      }),
    });
    const props = personCardProps({
      person: person(),
      targets: [e],
      edges: [e],
      now: NOW,
    });
    expect(props.fact).toBe("Obecnie: Rada Społeczna · SPZOZ");
  });

  it("keeps a current non-public post rather than dropping to an older rung", () => {
    const e = edge({
      name: "prezydent",
      richNode: { type: "region", name: "Miasto Warszawa" },
    });
    const props = personCardProps({
      person: person({ name: "Rafał Trzaskowski", parties: ["PO"] }),
      targets: [e],
      edges: [e],
      now: NOW,
    });
    expect(props.fact).toBe("Obecnie: prezydent · Miasto Warszawa");
    // No isPublic employer and no candidacies, so nothing qualifies as a stat.
    expect(props.stat1Value).toBe("");
  });

  it("falls back to candidacies, then to nothing at all", () => {
    const e = edge({
      type: "election",
      richNode: { type: "region", name: "Gdynia" },
    });
    const withElection = personCardProps({
      person: person(),
      targets: [],
      edges: [e],
      now: NOW,
    });
    expect(withElection.fact).toBe("Starty w wyborach: Gdynia");
    expect(withElection.stat1Label).toBe("kandydatura");

    const bare = personCardProps({
      person: person(),
      targets: [],
      edges: [],
      now: NOW,
    });
    expect(bare.fact).toBe("");
    expect(bare.chipLabel).toBe("bez partii w bazie");
    // No employment edge means no register provenance to claim.
    expect(bare.foot).toBe(
      "Społeczna baza powiązań w instytucjach publicznych. Stan bazy: wrzesień 2026.",
    );
    expect(bare.stat1Value).toBe("");
  });

  it("hedges the party and never fills a chip for two of them", () => {
    const one = personCardProps({
      person: person({ parties: ["PO"] }),
      targets: [],
      edges: [],
      now: NOW,
    });
    expect(one.chipLabel).toBe("partia w bazie: PO");
    expect(one.chipFill).toBe("#fca241");

    const two = personCardProps({
      person: person({ parties: ["PO", "Nowoczesna"] }),
      targets: [],
      edges: [],
      now: NOW,
    });
    expect(two.chipLabel).toBe("partie w bazie: PO, Nowoczesna");
    expect(two.chipFill).toBe("");
  });

  it("reads parties stored as a numbered-key object", () => {
    // Firestore hands arrays back that way; `array-contains` and `.length` both
    // fail on one silently.
    const props = personCardProps({
      person: person({ parties: { "0": "PSL" } }),
      targets: [],
      edges: [],
      now: NOW,
    });
    expect(props.chipLabel).toBe("partia w bazie: PSL");
  });

  it("counts distinct public employers, not edges", () => {
    const seats = [
      edge({
        target: "a",
        richNode: place("A", { isPublic: true }),
        end_date: "2020-01-01",
      }),
      edge({
        target: "a",
        richNode: place("A", { isPublic: true }),
        end_date: "2021-01-01",
      }),
      edge({
        target: "b",
        richNode: place("B", { isPublic: true }),
        end_date: "2022-01-01",
      }),
    ];
    const props = personCardProps({
      person: person(),
      targets: seats,
      edges: seats,
      now: NOW,
    });
    expect(props.stat1Value).toBe("2");
    expect(props.stat1Label).toBe("instytucje publiczne");
  });

  it("shrinks the type for a long name and marks more current seats", () => {
    const seats = [
      edge({
        target: "a",
        richNode: place("A", { isPublic: true }),
        start_date: "2024-01-01",
      }),
      edge({
        target: "b",
        richNode: place("B", { isPublic: true }),
        start_date: "2023-01-01",
      }),
    ];
    const props = personCardProps({
      person: person({ name: "Krzysztof Jan Wielkopolski-Mazowiecki" }),
      targets: seats,
      edges: seats,
      now: NOW,
    });
    expect(props.nameSize).toBe(58);
    expect(props.fact).toBe("Obecnie: A +1");
  });
});

describe("companyCardProps", () => {
  const base = { owners: [], subsidiaryCount: 0, now: NOW };

  it("names the organs and counts distinct people in each", () => {
    const board = [
      edge({
        name: "Zarząd",
        source: "p1",
        richNode: { type: "person", name: "A" },
      }),
      edge({
        name: "Zarząd",
        source: "p2",
        richNode: { type: "person", name: "B" },
      }),
      edge({
        name: "Rada Nadzorcza",
        source: "p3",
        richNode: { type: "person", name: "C" },
      }),
    ];
    const props = companyCardProps({
      ...base,
      company: company({
        isPublic: true,
        categories: ["energetyka"],
        krsNumber: "0000012483",
      }),
      sources: board,
      location: "Poznań",
    });
    expect(props.eyebrow).toBe("ENERGETYKA");
    expect(props.chipLabel).toBe("Instytucja publiczna");
    expect(props.fact).toBe(
      "Obecny skład: Zarząd — 2 osoby · Rada Nadzorcza — 1 osoba",
    );
    expect(props.foot).toBe(
      "KRS 0000012483 · siedziba: Poznań · stan bazy: wrzesień 2026",
    );
    expect(props.stat1Value).toBe("3");
    expect(props.stat1Label).toBe("osoby obecnie");
  });

  it("does not count institutions as board members", () => {
    // The place node "Rząd" carries outgoing `employed` edges to ministries; an
    // incoming-edge filter alone would report them as people.
    const props = companyCardProps({
      ...base,
      company: company({ name: "Rząd" }),
      sources: [
        edge({ source: "m1", richNode: place("Ministerstwo Infrastruktury") }),
        edge({ source: "m2", richNode: place("Ministerstwo Zdrowia") }),
      ],
    });
    expect(props.fact).toBe("");
    expect(props.stat1Value).toBe("");
  });

  it("counts one person holding two seats once", () => {
    const board = [
      edge({
        name: "Zarząd",
        source: "p1",
        richNode: { type: "person", name: "A" },
      }),
      edge({
        name: "Zarząd",
        source: "p1",
        richNode: { type: "person", name: "A" },
      }),
    ];
    const props = companyCardProps({
      ...base,
      company: company({ isPublic: true }),
      sources: board,
    });
    expect(props.fact).toBe("Obecny skład: Zarząd — 1 osoba");
    expect(props.stat1Value).toBe("1");
  });

  it("reports a wholly historical board as past, not present", () => {
    const props = companyCardProps({
      ...base,
      company: company({ isPublic: true }),
      sources: [
        edge({
          name: "Zarząd",
          source: "p1",
          richNode: { type: "person", name: "A" },
          end_date: "2021-05-05",
        }),
      ],
    });
    expect(props.fact).toBe("Dawne władze w bazie: 1 osoba");
    expect(props.stat1Label).toBe("osoba w organach");
  });

  it("treats an absent isPublic exactly like a false one", () => {
    // The model says neither is evidence of private ownership.
    for (const fields of [{}, { isPublic: false }]) {
      const props = companyCardProps({
        ...base,
        company: company(fields),
        sources: [],
      });
      expect(props.chipLabel).toBe("Właściciel nieustalony");
      expect(props.chipFill).toBe("");
    }
    const manual = companyCardProps({
      ...base,
      company: company({ isPublic: false, isPublicSource: "manual" }),
      sources: [],
    });
    expect(manual.chipLabel).toBe("Podmiot prywatny");
  });

  it("says so when an institution has no register entry", () => {
    const props = companyCardProps({
      ...base,
      company: company({ name: "MINISTERSTWO INFRASTRUKTURY" }),
      sources: [],
      location: "Warszawa",
    });
    expect(props.eyebrow).toBe("INSTYTUCJA");
    expect(props.fact).toBe("Siedziba: Warszawa");
    expect(props.foot).toBe(
      "Brak wpisu w KRS · siedziba: Warszawa · stan bazy: wrzesień 2026",
    );
    expect(props.nameSize).toBe(58);
  });

  it("only calls a place-to-place owner an owner", () => {
    // A region on an `owns` edge is the registered seat, not a shareholding.
    const region = companyCardProps({
      ...base,
      company: company(),
      sources: [],
      owners: [
        edge({ type: "owns", richNode: { type: "region", name: "Poznań" } }),
      ],
      location: "Poznań",
    });
    expect(region.fact).toBe("Siedziba: Poznań");

    const parent = companyCardProps({
      ...base,
      company: company(),
      sources: [],
      owners: [edge({ type: "owns", richNode: place("SKARB PAŃSTWA") })],
    });
    expect(parent.fact).toBe("Właściciel: SKARB PAŃSTWA");
  });

  it("calls a subsidiary a podmiot, not a spółka", () => {
    // An SPZOZ or a fundusz held through an `owns` edge is not a spółka.
    const props = companyCardProps({
      ...base,
      company: company({ isPublic: true }),
      sources: [],
      subsidiaryCount: 19,
    });
    expect(props.stat1Value).toBe("19");
    expect(props.stat1Label).toBe("podmiotów zależnych");
  });

  it("clamps a register-length name to the smallest tier", () => {
    const props = companyCardProps({
      ...base,
      company: company({
        name: "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ W MIŃSKU MAZOWIECKIM",
        isPublic: true,
        categories: ["szpitale"],
      }),
      sources: [],
    });
    expect(props.nameSize).toBe(38);
    expect(props.eyebrow).toBe("SZPITALE");
  });

  it("never names an individual", () => {
    const props = companyCardProps({
      ...base,
      company: company({ isPublic: true }),
      sources: [
        edge({
          name: "Zarząd",
          source: "p1",
          richNode: { type: "person", name: "Marcin Chludziński" },
        }),
      ],
    });
    const printed = [props.name, props.fact, props.foot, props.stat1Label].join(
      " ",
    );
    expect(printed).not.toContain("Chludziński");
  });
});
