import type { Company, Person, Region } from "../../../shared/model";
import type { PersonSuccessions } from "../../../server/api/edges/successions.get";
import {
  employment,
  graphCompany,
  graphPerson,
  graphRegion,
  layout,
  personPost,
  relation,
  type EntityPageFixture,
  type Spell,
  type Who,
} from "./entityGraph";

/** A person's page for person-page.spec.ts, with something in every part the
 * redesign changed (Szymon, 2026-10-23 and -24): a fact of every kind on the
 * line under the name, a bio long enough to fold on a phone, and a history
 * with a row in each of the ledger's groups - a person in „Osoby”, posts held
 * today, posts that ended and one the register never dated.
 *
 * Not the seed's people, who have one or two relations each and none of the
 * facts the header lists, and whom half the suite reads or writes. Answered
 * by route handlers instead. She is made up, like everybody and everything
 * around her: the company she runs is the one ./companyPage.ts photographs
 * with its board, where she took the seat from the same predecessor. */

const HALINA: Person & { id: string } = {
  id: "vishalina",
  name: "Halina Przykładowa",
  type: "person",
  parties: ["PO"],
  birthDate: "1976-02-14",
  education: "magister inżynierii środowiska",
  wikipedia: "https://pl.wikipedia.org/wiki/Halina_Przykładowa",
  rejestrIo: "https://rejestr.io/osoby/9900001/halina-przykladowa",
  ktomaco: "https://ktomaco.pl/osoba/halina-przykladowa",
  // Past the 214 characters at which a bio folds on a phone
  // (BIO_FOLD_MIN_LENGTH in EntityDetailsCard.vue), so the phone shows four
  // lines and „Pokaż więcej”.
  content:
    "Inżynierka środowiska, od maja 2024 roku prezeska Przedsiębiorstwa " +
    "Wodociągów i Kanalizacji Przykładowo. Wcześniej w zarządzie miejskiego " +
    "przewoźnika i w radzie nadzorczej gminnego holdingu. W latach 2018-2024 " +
    "radna Miasta Przykładowo, wybrana z listy komitetu Wspólne Przykładowo.",
  published: true,
};

const company = (
  id: string,
  name: string,
  extra: Partial<Company> = {},
): Company & { id: string } => ({
  id,
  name,
  type: "place",
  isPublic: true,
  published: true,
  ...extra,
});

const PWIK = company(
  "vispwik",
  "Przedsiębiorstwo Wodociągów i Kanalizacji Przykładowo sp. z o.o.",
  { categories: ["wodociagi"] },
);
const FUNDACJA = company("visfundacja", "Fundacja Rozwoju Przykładowa");
const MPK = company(
  "vismpk",
  "Miejskie Przedsiębiorstwo Komunikacji Przykładowo sp. z o.o.",
  { categories: ["komunikacja-miejska"] },
);
const HOLDING = company(
  "visholding",
  "Przykładowy Holding Komunalny sp. z o.o.",
);
/** A housing cooperative, which no public body owns. */
const SPOLDZIELNIA = company(
  "visspoldzielnia",
  "Spółdzielnia Mieszkaniowa Przykładowo",
  { isPublic: false },
);
const MIASTO: Region & { id: string } = {
  id: "vismiasto",
  name: "Miasto Przykładowo",
  type: "region",
  teryt: "9901021",
};

const halina: Who = { id: HALINA.id, name: HALINA.name, parties: ["PO"] };
/** In „Osoby”: the one relation that leads to a person. */
const jacek: Who = { id: "visjacek", name: "Jacek Testowy", parties: ["PO"] };
/** Whose seat she took. His page is a draft, so a reader who is not signed
 * in is not told his name. */
const grzegorz: Who = {
  id: "visgrzegorz",
  name: "Grzegorz Próbny",
  parties: ["PiS"],
};
/** Who took hers, and a draft as well. */
const wieslaw: Who = { id: "viswieslaw", name: "Wiesław Przykładny" };

/* Her posts: two held today, two that ended, one the register never dated. */
const prezes: Spell = {
  id: "vishalinapwik",
  who: halina,
  role: "Prezes Zarządu",
  start: "2024-05-15",
};
const fundacja: Spell = {
  id: "vishalinafundacja",
  who: halina,
  role: "Członek Rady Fundacji",
  start: "2025-01-10",
};
const zarzad: Spell = {
  id: "vishalinampk",
  who: halina,
  role: "Członek Zarządu",
  start: "2017-03-01",
  end: "2021-01-31",
};
const rada: Spell = {
  id: "vishalinaholding",
  who: halina,
  role: "Rada Nadzorcza",
  start: "2014-05-20",
  end: "2017-02-28",
};
const prokura: Spell = {
  id: "vishalinaspoldzielnia",
  who: halina,
  role: "Prokurent",
};

/** The other side of each handover, in the seat she took and the one she
 * left: one day after Grzegorz Próbny's last, and 46 days before Wiesław
 * Przykładny's first. */
const before: Spell = {
  id: "vispwikp7",
  who: grzegorz,
  role: "Prezes Zarządu",
  start: "2022-12-01",
  end: "2024-05-14",
};
const after: Spell = {
  id: "vismpkwieslaw",
  who: wieslaw,
  role: "Członek Zarządu",
  start: "2021-03-18",
};

/** Signed in, both handovers by name: one that took the seat from PiS to PO,
 * and one on a day two of the board's seats changed hands at once, which the
 * card hedges under its row. */
const named: PersonSuccessions = {
  posts: [
    personPost(PWIK, prezes, { predecessor: before }),
    personPost(MPK, zarzad, { successor: after }, 2),
  ],
  hidden: 0,
};

/** Signed out, the same two counted rather than named - the line that stands
 * in for the section when nothing in it may be shown. */
const withheld: PersonSuccessions = { posts: [], hidden: 2 };

export const personPage: EntityPageFixture = {
  id: HALINA.id,
  url: "/osoba/halina-przykladowa-vishalina",
  node: HALINA,
  graph: layout(
    [
      graphPerson(halina),
      graphPerson(jacek),
      graphCompany(PWIK, 14),
      graphCompany(FUNDACJA, 5),
      graphCompany(MPK, 9),
      graphCompany(HOLDING, 3),
      graphCompany(SPOLDZIELNIA, 4),
      graphRegion(MIASTO),
    ],
    [
      relation({
        id: "vishalinajacek",
        source: halina.id,
        target: jacek.id,
        type: "connection",
        name: "współpracownik",
      }),
      // Cited to one article, so even a reader who may not cite sees the
      // count - and the other dated rows keep its room, so their dates stay
      // in line (`reserveSources`).
      { ...employment(prezes, PWIK.id), references: ["visartykul"] },
      employment(fundacja, FUNDACJA.id),
      employment(zarzad, MPK.id),
      employment(rada, HOLDING.id),
      employment(prokura, SPOLDZIELNIA.id),
      // A candidacy is dated with its election day, as start and end both,
      // and the row prints its year.
      relation({
        id: "vishalinarada",
        source: halina.id,
        target: MIASTO.id,
        type: "election",
        name: "kandydatura",
        position: "Rada miasta",
        party: "PO",
        committee: "KWW Wspólne Przykładowo",
        elected: true,
        start_date: "2018-10-21",
        end_date: "2018-10-21",
      }),
    ],
  ),
  successions: { reader: withheld, editor: named },
};
