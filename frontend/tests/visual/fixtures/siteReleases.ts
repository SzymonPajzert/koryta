import type {
  ActivityFeed,
  FeedActor,
  FeedBatch,
  FeedTarget,
  SiteChange,
} from "../../../shared/activityFeed";
import type { QaArea } from "../../../shared/qa";
import { NOW } from "../clock";

/**
 * koryta.pl's own rollouts on /aktywnosc, as round aktywnosc-wersje-r1
 * approved them: „Nowa wersja strony” on a tinted badge among the day's
 * lines, and the rollouts alone under the „koryta.pl” filter.
 *
 * REAL
 *   the entries: titles, links and areas of /qa entries as they stood on
 *     2026-11-18, copied rather than imported, so that a new entry in
 *     shared/qa.ts does not move these pictures; descriptions cut to their
 *     first sentence
 * MADE UP
 *   which rollout holds which entries, and the people's lines, with
 *   surnames that match nobody (Przykładowy, Szablonowy, Atrapowy, Próbny,
 *   Szkicowy)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** An instant `days` before NOW at a UTC hour and minute. Warsaw is UTC+2
 * on these dates. */
const at = (days: number, hour: number, minute: number) =>
  new Date(
    Date.UTC(
      NOW.getUTCFullYear(),
      NOW.getUTCMonth(),
      NOW.getUTCDate() - days,
      hour,
      minute,
    ),
  ).toISOString();

const entry = (
  id: string,
  title: string,
  description: string,
  area: QaArea,
  link?: string,
) => ({ id, title, description, area, ...(link ? { link } : {}) });

/** Today's rollout: seven entries, so desktop lists five and asks for two
 * more, a phone three and four. */
const TODAY = [
  entry(
    "aktywnosc-zmiany-na-stronie",
    "Aktywność mówi też, co zmieniło się na stronie",
    "Każda nowa wersja koryta.pl jest na /aktywnosc pod dniem, w którym weszła, z tytułami jej wpisów z /qa.",
    "contributor",
    "/aktywnosc",
  ),
  entry(
    "polityka-prywatnosci-zapytania-wyszukiwarki",
    "Polityka prywatności o zapytaniach z wyszukiwarki",
    "Polityka mówi teraz, że zapisujemy, czego czytelnicy szukają, i że trzymamy to 180 dni.",
    "public",
    "/plik/polityka_prywatnosci",
  ),
  entry(
    "procesy-odpisy-krokiem-nocy",
    "Procesy: odpisy pełne jako krok nocy",
    "Wiersz „Odpisy pełne z wyszukiwarki KRS” mówił, że chodzą ręcznie i bez pory, choć pobiera je noc.",
    "admin",
    "/admin/procesy",
  ),
  entry(
    "poparcie-pkw-na-kandydaturach",
    "Poparcie i członkostwo z PKW na kandydaturach",
    "Przed komitetem kandydatury: partia, która według PKW poparła kandydata, albo nazwa organizacji.",
    "public",
  ),
  entry(
    "duplikaty-pod-paskiem-oswiadczen",
    "„Duplikaty” zamiast „osobno imiennicy” pod paskiem oświadczeń",
    "Pod paskiem osób w zakładce „Oświadczenia” na głównej jest teraz „duplikaty:” z liczbą.",
    "public",
    "/oswiadczenia/postep",
  ),
  entry(
    "postep-oswiadczen-na-biezaco",
    "Postęp oświadczeń na bieżąco",
    "Liczby w zakładce „Oświadczenia” na głównej strona liczy co noc.",
    "public",
    "/oswiadczenia/postep",
  ),
  entry(
    "prosba-o-odczyt-skanow-na-stronie-osoby",
    "Na stronie osoby prośba o odczytanie kilku skanów oświadczeń",
    "Nad „Historią powiązań” połowa niezalogowanych czytelników widzi przycisk „Odczytaj skany”.",
    "public",
  ),
];

const YESTERDAY = [
  entry(
    "statystyki-kafelki",
    "Statystyki: trzy kafelki pod tytułem",
    "Linki do oświadczeń, rad szpitali i „Pomóż sprawdzać” wyglądają tak samo: kafelek z ikoną, nazwą i jednym zdaniem.",
    "public",
    "/eksploruj/statystyki",
  ),
];

const THREE_DAYS_AGO = [
  entry(
    "mapa-strony-bez-daty-24-pazdziernika-1408",
    "Mapa strony nie podaje już jednej daty dla tysięcy stron",
    "Każda strona w /sitemap.xml ma datę tego, co naprawdę się na niej zmieniło.",
    "admin",
    "/sitemap.xml",
  ),
  entry(
    "bez-liczby-osob-przy-wlascicielach",
    "Bez liczby w nawiasie przy właścicielach i spółkach zależnych",
    "Listy „Właściciele” i „Spółki zależne” nie pokazują już liczby w nawiasie po nazwie.",
    "public",
  ),
  entry(
    "fundator-wsrod-wlascicieli",
    "Fundator fundacji wśród jej właścicieli, a fundacja wśród spółek zależnych fundatora",
    "Fundacja, którą założyła instytucja publiczna, jest teraz instytucją publiczną.",
    "public",
  ),
];

const rollout = (when: string, entries: ReturnType<typeof entry>[]) =>
  entries.map((item): SiteChange => ({ ...item, at: when }));

const siteChanges: SiteChange[] = [
  ...rollout(at(0, 9, 20), TODAY),
  ...rollout(at(1, 13, 34), YESTERDAY),
  ...rollout(at(3, 16, 2), THREE_DAYS_AGO),
];

// ---------------------------------------------------------------------------
// The people's lines, as an established administrator sees them
// ---------------------------------------------------------------------------

const PEOPLE = [
  "Jan Szablonowy",
  "Ewa Atrapowa",
  "Małgorzata Przykładowa-Szablonowa",
  "Maria Szkicowa",
  "Tomasz Przykładowy",
  "Piotr Próbny",
  "Katarzyna Atrapowa",
  "Paweł Szkicowy",
  "Anna Próbna",
  "Michał Szablonowy",
];

const targets = (from: number, count: number): FeedTarget[] =>
  Array.from({ length: count }, (_, index) => {
    const name = PEOPLE[(from + index) % PEOPLE.length]!;
    const id = `p${from + index}`;
    return { key: id, type: "person", name, href: `/osoba/${id}` };
  });

const actor = (
  key: string,
  name: string,
  extra: Partial<FeedActor> = {},
): FeedActor => ({
  key,
  uid: key === "automat" ? null : key,
  name,
  named: true,
  isSelf: false,
  photoURL: null,
  newAdmin: false,
  ...extra,
});

const ZOFIA = actor("uid-zofia", "Zofia Przykładowa");
const MAREK = actor("uid-marek", "Marek Szkicowy");
const OLA = actor("uid-ola", "Ola Atrapowa", { newAdmin: true });
const PAWEL = actor("uid-pawel", "Paweł Próbny");
const AUTOMATION = actor("automat", "Automat", { automated: true });

/** The next person in PEOPLE, so neighbouring lines list different people. */
let nextPerson = 0;

const line = (
  who: FeedActor,
  kind: FeedBatch["kind"],
  firstAt: string,
  lastAt: string,
  count: number,
  listed: number,
): FeedBatch => {
  const counted = kind === "note" || kind === "proposal";
  const shown = Math.min(listed, count);
  const from = nextPerson;
  nextPerson += shown;
  return {
    id: `${who.key}:${kind}:${firstAt}`,
    kind,
    actorKey: who.key,
    firstAt,
    lastAt,
    count,
    objects: counted ? {} : { person: count },
    alongEdges: 0,
    targets: targets(from, shown),
    moreTargets: counted ? 0 : count - shown,
  };
};

/** Ten lines, so the week is enough and the page does not widen to the
 * month by itself. */
const batches: FeedBatch[] = [
  line(ZOFIA, "vote", at(0, 9, 30), at(0, 9, 52), 6, 6),
  line(MAREK, "publish", at(0, 7, 5), at(0, 8, 40), 9, 6),
  line(OLA, "proposal", at(1, 16, 10), at(1, 16, 40), 3, 3),
  line(AUTOMATION, "autoPublish", at(1, 7, 12), at(1, 15, 47), 46, 8),
  line(ZOFIA, "vote", at(2, 18, 5), at(2, 18, 50), 8, 6),
  line(PAWEL, "note", at(2, 10, 0), at(2, 10, 30), 2, 2),
  line(MAREK, "publish", at(3, 12, 1), at(3, 12, 40), 4, 4),
  line(OLA, "proposal", at(4, 14, 10), at(4, 14, 25), 2, 2),
  line(PAWEL, "note", at(5, 9, 0), at(5, 9, 45), 3, 3),
  line(AUTOMATION, "autoPublish", at(6, 7, 4), at(6, 16, 31), 42, 8),
];

export const releaseFeed: ActivityFeed = {
  window: {
    since: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    until: NOW.toISOString(),
    days: 7,
  },
  identified: true,
  actors: [ZOFIA, MAREK, OLA, PAWEL, AUTOMATION],
  batches,
  newAdmins: [],
  truncated: [],
  siteChanges,
};
