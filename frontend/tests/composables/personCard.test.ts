import { describe, it, expect } from "vitest";
import {
  BAR_SCALE,
  personPageCardProps,
  type PersonCardProps,
} from "../../app/composables/personCard";
import type { EdgeNode } from "../../app/composables/edges";
import type { Person } from "../../shared/model";

/** A fixed clock, so nothing here moves with the calendar. */
const NOW = new Date("2026-11-28T00:00:00Z");

function person(fields: Record<string, unknown> = {}): Person {
  return {
    type: "person",
    name: "Danuta Obejmująca",
    parties: ["PO"],
    ...fields,
  } as unknown as Person;
}

let next = 0;

/** A post at an institution, as `useEdges` hands it over. */
function post(
  institution: string,
  fields: Record<string, unknown> = {},
  company: Record<string, unknown> = {},
): EdgeNode {
  next += 1;
  return {
    id: `e${next}`,
    type: "employed",
    label: (fields.name as string | undefined) ?? "Zatrudniony/a w",
    name: fields.name as string | undefined,
    source: "osoba",
    target: `firma${next}`,
    richNode: { type: "place", name: institution, ...company },
    ...fields,
  } as unknown as EdgeNode;
}

function card(edges: EdgeNode[], fields: Record<string, unknown> = {}) {
  return personPageCardProps({ person: person(fields), edges, now: NOW });
}

const rowNames = (props: PersonCardProps) =>
  [props.row1Name, props.row2Name, props.row3Name].filter(Boolean);

describe("personPageCardProps", () => {
  it("puts public institutions first, newest first within each group", () => {
    const props = card([
      post("NOWA SPÓŁKA", { name: "Zarząd", start_date: "2026-10-15" }),
      post(
        "TAURON WYTWARZANIE",
        { name: "Rada Nadzorcza", start_date: "2022-12-30" },
        { isPublic: true },
      ),
      post(
        "SZPITAL",
        { name: "Rada Nadzorcza", start_date: "2021-10-27" },
        { isPublic: true },
      ),
      post("STARA SPÓŁKA", { name: "Zarząd", start_date: "2010-01-01" }),
    ]);
    expect(rowNames(props)).toEqual([
      "TAURON WYTWARZANIE",
      "SZPITAL",
      "NOWA SPÓŁKA",
    ]);
    expect(props.row1Public).toBe("1");
    expect(props.row3Public).toBe("");
    expect(props.more).toBe("+ 1 powiązanie");
  });

  it("counts what it leaves out in Polish", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      post(`FIRMA ${i}`, {
        name: "Zarząd",
        start_date: `20${String(i).padStart(2, "0")}-01-01`,
      }),
    );
    expect(card(many).more).toBe("+ 22 powiązania");
    expect(card(many.slice(0, 8)).more).toBe("+ 5 powiązań");
    expect(card(many.slice(0, 3)).more).toBe("");
  });

  it("runs the bars from the earliest row on the card to today", () => {
    // The 2010 post is not on the card, so it does not stretch the axis.
    const props = card([
      post(
        "A",
        { name: "Zarząd", start_date: "2024-11-28" },
        { isPublic: true },
      ),
      post(
        "B",
        { name: "Zarząd", start_date: "2025-11-28", end_date: "2026-05-29" },
        { isPublic: true },
      ),
      post(
        "C",
        { name: "Zarząd", start_date: "2025-05-29" },
        { isPublic: true },
      ),
      post("D", { name: "Zarząd", start_date: "2010-01-01" }),
    ]);
    // A, the earliest shown, starts the axis and is current: the whole bar.
    expect([props.row3From, props.row3To]).toEqual([0, BAR_SCALE]);
    // B: a year in, half a year long, on a two year axis.
    expect(props.row1From).toBeCloseTo(500, -1);
    expect(props.row1To).toBeCloseTo(750, -1);
  });

  it("gives a recent post room by spanning a year at least", () => {
    const props = card([
      post("NOWA", { name: "Zarząd", start_date: "2026-10-28" }),
    ]);
    // 334 days into a 365 day axis.
    expect(props.row1From).toBe(915);
    expect(props.row1To).toBe(BAR_SCALE);
    expect(props.row1Period).toBe("2026-10-28 - obecnie");
  });

  it("writes the page's dates, and none it does not have", () => {
    const props = card([
      post("A", {
        name: "Zarząd",
        start_date: "2018-01-23",
        end_date: "2022-12-01",
      }),
      post("B", { name: "Zarząd" }),
    ]);
    expect(props.row2Period).toBe("2018-01-23 - 2022-12-01");
    // Undated: no label, and the bar from the axis's start.
    expect(props.row1Period).toBe("");
    expect(props.row1From).toBe(0);
  });

  it("names a candidacy by what it was for", () => {
    const props = card([
      {
        id: "k1",
        type: "election",
        label: "kandydatura",
        position: "Sejmik",
        source: "osoba",
        target: "mazowieckie",
        start_date: "2024-04-07",
        end_date: "2024-04-07",
        richNode: { type: "region", name: "Województwo mazowieckie" },
      } as unknown as EdgeNode,
    ]);
    expect(props.row1Name).toBe("Województwo mazowieckie");
    expect(props.row1Role).toBe("kandydatura · Sejmik");
    expect(props.row1Period).toBe("2024-04-07");
  });

  it("names no other person", () => {
    const props = card([
      {
        id: "z1",
        type: "connection",
        label: "Znajomy",
        source: "osoba",
        target: "ktos",
        richNode: { type: "person", name: "Jan Nowak" },
      } as unknown as EdgeNode,
      post("ORLEN", { name: "Zarząd", start_date: "2023-04-01" }),
    ]);
    expect(rowNames(props)).toEqual(["ORLEN"]);
    expect(props.more).toBe("");
  });

  it("tells the sector by its title", () => {
    const props = card([
      post(
        "ZAKŁAD WODOCIĄGÓW",
        { name: "Rada Nadzorcza", start_date: "2026-05-06" },
        { isPublic: true, categories: ["wodociagi"] },
      ),
    ]);
    expect(props.row1Sector).toBe("Wodociągi i kanalizacja");
  });

  it("lists up to three parties beside the name, in the page's order", () => {
    const props = card([], {
      parties: ["Nowa Lewica", "SLD", "Inne", "PO"],
    });
    expect([props.party1, props.party2, props.party3]).toEqual([
      "Nowa Lewica",
      "SLD",
      "Inne",
    ]);
    const none = card([], { parties: [] });
    expect([none.party1, none.party2, none.party3]).toEqual(["", "", ""]);
  });

  it("sizes the name so it shares a line with its chips", () => {
    expect(card([], { name: "Damian Pilarz" }).nameSize).toBe(56);
    expect(card([], { name: "Tadeusz Leszek Bałchanowski" }).nameSize).toBe(48);
    expect(
      card([], { name: "Paulina Krystyna Piechna-Więckiewicz" }).nameSize,
    ).toBe(40);
  });

  it("draws an empty history when there is none", () => {
    const props = card([]);
    expect(rowNames(props)).toEqual([]);
    expect(props.more).toBe("");
  });
});
