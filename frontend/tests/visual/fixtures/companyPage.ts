import type { Company, Region } from "../../../shared/model";
import {
  companySuccessions,
  employment,
  graphCompany,
  graphPerson,
  graphRegion,
  layout,
  relation,
  type EntityPageFixture,
  type Spell,
  type Who,
} from "./entityGraph";

/** Two companies' pages for company-page.spec.ts, one for each way the
 * redesigned page opens (Szymon, 2026-10-23 and -24): with nobody known to
 * hold a post today, and with a board, a long relay and the lists between.
 *
 * Neither could be the seed's. Its one company with a board history,
 * `sukspolka`, has three handovers - the fold needs more than five in one
 * function - a board known today, and nothing under „Właściciele” but its
 * seat. And it is the company `instytucja-strona` and several other shots
 * already photograph, so growing it would move all of them. These two are
 * answered by route handlers instead, and seen by nothing else. Every person
 * and company here is made up, and so is every number. */

/** The gmina both companies sit in. */
const GMINA: Region & { id: string } = {
  id: "visgmina",
  name: "Gmina Przykładowo",
  type: "region",
  teryt: "9901011",
};

const seat = (companyId: string) =>
  relation({
    id: `${companyId}-seat`,
    source: GMINA.id,
    target: companyId,
    type: "seat",
  });

/* ---------- a company nobody is known to run today ---------- */

const ZGO: Company & { id: string } = {
  id: "viszgo",
  // In capitals, as the register writes most names: the page sets such a
  // title one step down.
  name: "ZAKŁAD GOSPODARKI ODPADAMI PRZYKŁADOWO SP. Z O.O.",
  type: "place",
  krsNumber: "0000990101",
  isPublic: true,
  categories: ["odpady"],
  published: true,
};

const zgo = {
  anna: { id: "viszgoanna", name: "Anna Przykładowa", parties: ["PSL"] },
  bogdan: { id: "viszgobogdan", name: "Bogdan Wzorcowy" },
  celina: { id: "viszgocelina", name: "Celina Testowa", parties: ["PiS"] },
  dariusz: { id: "viszgodariusz", name: "Dariusz Próbny" },
} satisfies Record<string, Who>;

/** Every post listed here has ended. Two of the seats went on to people who
 * have no page anybody may open yet, and the endpoint answers a reader who is
 * not signed in accordingly: nobody on today's board, the two handovers
 * counted rather than named - which is what the page's one quiet line
 * (`company-absent`) is for. Anna and Bogdan are 244 days apart, past the
 * pairing's 120-day window, so they make no handover of their own. */
const zgoSpells: Spell[] = [
  {
    id: "viszgoedge1",
    who: zgo.anna,
    role: "Prezes Zarządu",
    start: "2014-03-01",
    end: "2020-06-30",
  },
  {
    id: "viszgoedge2",
    who: zgo.bogdan,
    role: "Prezes Zarządu",
    start: "2021-03-01",
    end: "2025-03-31",
  },
  {
    id: "viszgoedge3",
    who: zgo.celina,
    role: "Rada Nadzorcza",
    start: "2017-05-10",
    end: "2023-06-30",
  },
  {
    id: "viszgoedge4",
    who: zgo.dariusz,
    role: "Prokurent",
    start: "2019-01-15",
    end: "2024-02-29",
  },
];

const withoutBoard = companySuccessions(ZGO, [], [], 2);

export const companyWithoutBoard: EntityPageFixture = {
  id: ZGO.id,
  url: "/instytucja/zaklad-gospodarki-odpadami-przykladowo-sp-z-o-o-viszgo",
  node: ZGO,
  graph: layout(
    [
      graphCompany(ZGO, zgoSpells.length),
      graphRegion(GMINA),
      ...Object.values(zgo).map(graphPerson),
    ],
    [seat(ZGO.id), ...zgoSpells.map((spell) => employment(spell, ZGO.id))],
  ),
  // The same answer for both: an editor would see the two drafts, and this
  // page is photographed signed out.
  successions: { reader: withoutBoard, editor: withoutBoard },
};

/* ---------- a company with a board, a long relay and its owners ---------- */

const PWIK: Company & { id: string } = {
  id: "vispwik",
  name: "Przedsiębiorstwo Wodociągów i Kanalizacji Przykładowo sp. z o.o.",
  type: "place",
  krsNumber: "0000990202",
  isPublic: true,
  categories: ["wodociagi"],
  wikipedia:
    "https://pl.wikipedia.org/wiki/Przedsiębiorstwo_Wodociągów_i_Kanalizacji_Przykładowo",
  published: true,
};

/** Its other owner: a company with three people of its own. */
const HOLDING: Company & { id: string } = {
  id: "visholding",
  name: "Przykładowy Holding Komunalny sp. z o.o.",
  type: "place",
  isPublic: true,
  published: true,
};

const pwik = {
  adam: { id: "visadam", name: "Adam Wzorcowy" },
  bozena: { id: "visbozena", name: "Bożena Testowa" },
  cezary: { id: "viscezary", name: "Cezary Próbny", parties: ["PO"] },
  danuta: { id: "visdanuta", name: "Danuta Przykładowa", parties: ["PiS"] },
  edmund: { id: "visedmund", name: "Edmund Wzorcowy", parties: ["PiS"] },
  felicja: { id: "visfelicja", name: "Felicja Testowa", parties: ["PiS"] },
  grzegorz: { id: "visgrzegorz", name: "Grzegorz Próbny", parties: ["PiS"] },
  halina: { id: "vishalina", name: "Halina Przykładowa", parties: ["PO"] },
  irena: { id: "visirena", name: "Irena Wzorcowa", parties: ["PiS"] },
  jacek: { id: "visjacek", name: "Jacek Testowy", parties: ["PO"] },
  kamil: { id: "viskamil", name: "Kamil Próbny", parties: ["PiS"] },
  lucyna: { id: "vislucyna", name: "Lucyna Przykładowa" },
  marek: { id: "vismarek", name: "Marek Wzorcowy" },
  natalia: {
    id: "visnatalia",
    name: "Natalia Testowa",
    parties: ["Polska 2050"],
  },
} satisfies Record<string, Who>;

const prezes = (id: string, who: Who, start: string, end?: string): Spell => ({
  id,
  who,
  role: "Prezes Zarządu",
  start,
  end,
});

/* Eight presidents in a row: seven handovers in one function, two more than
   the relay shows before „Pokaż starsze”. Every gap the row can say is here -
   the same day, one day, a few weeks, and two filings that overlap - and the
   newest handover, the one on top, takes the seat from PiS to PO, as the
   fifth took it from PO to PiS. */
const p1 = prezes("vispwikp1", pwik.adam, "2008-01-02", "2010-03-31");
const p2 = prezes("vispwikp2", pwik.bozena, "2010-03-31", "2012-11-30");
const p3 = prezes("vispwikp3", pwik.cezary, "2012-12-01", "2015-12-15");
const p4 = prezes("vispwikp4", pwik.danuta, "2016-01-04", "2018-06-30");
const p5 = prezes("vispwikp5", pwik.edmund, "2018-06-30", "2020-09-15");
const p6 = prezes("vispwikp6", pwik.felicja, "2020-10-01", "2022-12-31");
const p7 = prezes("vispwikp7", pwik.grzegorz, "2022-12-01", "2024-05-14");
const p8 = prezes("vispwikp8", pwik.halina, "2024-05-15");

const rada = (id: string, who: Who, start: string, end?: string): Spell => ({
  id,
  who,
  role: "Rada Nadzorcza",
  start,
  end,
});

/* The supervisory board: two members struck off and two entered on one day,
   which the relay draws as one card under the day, and a member whose term is
   entered ahead, to 30.06.2027. The register gives her an end date, so the
   endpoint does not count her as today's board and she stays in the history,
   the one row under „Obecnie”. */
const r1 = rada("vispwikr1", pwik.irena, "2019-06-20", "2023-06-20");
const r2 = rada("vispwikr2", pwik.kamil, "2019-06-20", "2023-06-20");
const r3 = rada("vispwikr3", pwik.jacek, "2023-06-20");
const r4 = rada("vispwikr4", pwik.lucyna, "2023-06-20");
const r5 = rada("vispwikr5", pwik.natalia, "2022-07-01", "2027-06-30");

/** On the board, with nobody before him: a card with no „wcześniej”. */
const z1: Spell = {
  id: "vispwikz1",
  who: pwik.marek,
  role: "Członek Zarządu",
  start: "2021-02-01",
};

const withBoard = companySuccessions(
  PWIK,
  [
    [p7, p8],
    [p6, p7],
    [p5, p6],
    [p4, p5],
    [p3, p4],
    [p2, p3],
    [p1, p2],
    [r1, r3],
    [r2, r4],
  ],
  [p8, z1, r3, r4],
);

/** The key `succession/CompanyChanges.vue` files the presidents' relay under:
 * the role, slugged. */
export const PREZES_RELAY = "prezes-zarzadu";

export const companyWithBoard: EntityPageFixture = {
  id: PWIK.id,
  url: "/instytucja/przedsiebiorstwo-wodociagow-i-kanalizacji-przykladowo-sp-z-o-o-vispwik",
  node: PWIK,
  graph: layout(
    [
      graphCompany(PWIK, Object.keys(pwik).length),
      graphCompany(HOLDING, 3),
      graphRegion(GMINA),
      ...Object.values(pwik).map(graphPerson),
    ],
    [
      // The gmina owns the company it seats: two edges, one owner.
      seat(PWIK.id),
      relation({
        id: "vispwik-owner-gmina",
        source: GMINA.id,
        target: PWIK.id,
        type: "owns",
      }),
      relation({
        id: "vispwik-owner-holding",
        source: HOLDING.id,
        target: PWIK.id,
        type: "owns",
      }),
      ...[p1, p2, p3, p4, p5, p6, p7, p8, r1, r2, r3, r4, r5, z1].map((spell) =>
        employment(spell, PWIK.id),
      ),
    ],
  ),
  // Photographed signed in, as an admin: every name has a page an editor may
  // open, so nothing is withheld.
  successions: { reader: withBoard, editor: withBoard },
};
