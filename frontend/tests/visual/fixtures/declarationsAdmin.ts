import { readFileSync } from "node:fs";
import type { NodeMentions } from "../../../server/api/nodes/[id]/mentions.get";
import type {
  DeclarationOverview,
  DeclarationPublicationRow,
  DeclarationReviewRow,
  LocalOffice,
  PersonDeclarations,
  PublicationHoldReason,
} from "../../../shared/declarations";
import { NOW } from "../clock";

/** The BIP declarations' two surfaces, for their visual tests: the admin
 * overview (/admin/oswiadczenia) and the line and the cards on a person's page.
 *
 * Shaped like production on 2026-10-29, twelve days into reading in a fiction
 * where it opened twelve days before the frozen clock (./clock.ts, so every
 * date here is counted back from it). Where each number comes from:
 *   REAL     counted on 2026-10-29, in production or in the prototype run
 *   DERIVED  nothing has run yet; worked out from the real numbers
 * This is the overview Szymon approved on the design board (round
 * bip-admin-r2) with the dates moved.
 *
 * Every person is made up: the surnames (Atrapa, Makieta, Przykładowy...)
 * are in neither the PKW candidates' nor the KRS people's list (see SURNAMES),
 * and the opened crop's page is the emulator seed's placeholder, Jan
 * Kowalski. So is every document link: they all point at `bip.example.pl`.
 * The units are real councils, which are public. No crop of a real
 * declaration is here or ever may be - they are handwriting of named people,
 * and the repo is public. The one crop the overview shows,
 * ./declaration-crop*.png, was cut from a fake scan whose "handwriting" is a
 * font. */

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** `hours` before the frozen clock, as the ISO string the APIs send. */
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - Math.round(hours * 3_600_000)).toISOString();

/** The frozen clock's day in Warsaw. */
const TODAY = NOW.toISOString().slice(0, 10);

/** `n` days ending with `last`, oldest first, as `YYYY-MM-DD`. */
function days(last: string, n: number): string[] {
  const end = Date.parse(`${last}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Made-up people, dates and links
// ---------------------------------------------------------------------------

/** Councils the prototype's crops came from (its queue_sorted.csv), with the
 * council of the unit's kind and a made-up year. */
const UNITS: {
  unit: string;
  office: LocalOffice | null;
  year: number | null;
}[] = [
  { unit: "Złota (gmina wiejska)", office: "Rada gminy", year: 2024 },
  { unit: "Koszalin (gmina miejska)", office: "Rada miasta", year: 2023 },
  {
    unit: "Białaczów (gmina miejsko-wiejska)",
    office: "Rada gminy",
    year: 2024,
  },
  { unit: "Powiat pruszkowski (Pruszków)", office: "Rada powiatu", year: 2022 },
  { unit: "Banie (gmina wiejska)", office: "Rada gminy", year: 2023 },
  { unit: "Bieruń (gmina miejska)", office: "Rada miasta", year: 2024 },
  { unit: "Gniewino (gmina wiejska)", office: "Rada gminy", year: 2019 },
  {
    unit: "Czemierniki (gmina miejsko-wiejska)",
    office: "Rada gminy",
    year: 2024,
  },
  { unit: "Rzeszów (gmina miejska)", office: "Rada miasta", year: 2024 },
  { unit: "Województwo wielkopolskie", office: "Sejmik", year: 2020 },
];

const unitAt = (i: number) => UNITS[i % UNITS.length]!;

const FIRST_NAMES = [
  "Zbigniew",
  "Halina",
  "Tomasz",
  "Ewa",
  "Piotr",
  "Barbara",
  "Krzysztof",
  "Anna",
  "Stanisław",
  "Małgorzata",
  "Józef",
  "Grażyna",
  "Marek",
  "Teresa",
  "Ryszard",
  "Danuta",
  "Andrzej",
  "Jadwiga",
  "Wiesław",
  "Elżbieta",
];

/** [he, she]: surnames no candidate and no company officer has, so a
 * screenshot cannot pass for a person. Checked on 2026-10-30: each stem
 * („szablonow”, „atrap”...) was searched for, case-insensitively and with the
 * JSON escapes decoded, in the pipelines' people_pkw_merged.jsonl and
 * people_krs_merged.jsonl, and none is in either. A surname can read as made
 * up and still be real - two that were here were - so search before adding
 * one. */
const SURNAMES: [string, string][] = [
  ["Atrapa", "Atrapa"],
  ["Szablonowy", "Szablonowa"],
  ["Fikcyjny", "Fikcyjna"],
  ["Atrapowy", "Atrapowa"],
  ["Makieta", "Makieta"],
  ["Szablon", "Szablon"],
  ["Szkicowy", "Szkicowa"],
  ["Testowy", "Testowa"],
  ["Przykład", "Przykład"],
  ["Próbny", "Próbna"],
  ["Makietowy", "Makietowa"],
  ["Przykładowy", "Przykładowa"],
  ["Pozorny", "Pozorna"],
  ["Umowny", "Umowna"],
];

function fakeName(i: number): string {
  const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
  const [he, she] = SURNAMES[(i * 5 + 3) % SURNAMES.length]!;
  return `${first} ${first.endsWith("a") ? she : he}`;
}

/** A page id that is obviously nobody's, without a hyphen (the page reads an
 * id off its url as whatever follows the last one). */
const fakeId = (i: number) => `fx${String(i).padStart(4, "0")}Atrapa00000000`;

/** A crop's id: a made-up sha256 and the page of the file it was cut from. */
const cropId = (i: number) =>
  `${(i + 1).toString(16).padStart(8, "0").repeat(8)}-p${i % 3}`;

function fakeDate(i: number): string {
  const y = 1946 + ((i * 7) % 42);
  const m = 1 + ((i * 5) % 12);
  const d = 1 + ((i * 11) % 28);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The likeliest wrong page date: day and month swapped, else ten years off. */
function swapped(date: string): string {
  const [y = "", m = "", d = ""] = date.split("-");
  if (Number(d) <= 12 && d !== m) return `${y}-${d}-${m}`;
  return `${Number(y) - 10}-${m}-${d}`;
}

const documentUrl = (year: number | null, i: number) =>
  `https://bip.example.pl/oswiadczenia-majatkowe/${year ?? "brak-roku"}/oswiadczenie-majatkowe-${101 + i}.pdf`;

// ---------------------------------------------------------------------------
// The crop
// ---------------------------------------------------------------------------

/** The disputed crop the overview's test opens. Its readings are what readers
 * would make of the synthetic crop: two read it right, two with the day and
 * the month swapped, one a decade off, and one gave up - six answers without
 * two agreeing ahead of the rest, which is what makes a crop disputed
 * (DISPUTED_AFTER). The name crop reads „Jan Kowalski”, so that is the page. */
export const OPENED_CROP: DeclarationReviewRow = {
  id: cropId(0),
  unit: "Złota (gmina wiejska)",
  office: "Rada gminy",
  declarationYear: 2024,
  documentUrl: documentUrl(2024, 0),
  status: "disputed",
  readings: [
    { value: "1965-03-12", readers: 2 },
    { value: "1965-12-03", readers: 2 },
    { value: "1955-03-12", readers: 1 },
  ],
  unreadable: 1,
  agreed: null,
  agreedBy: null,
  machine: { birthDate: "1965-03-12", confidence: "low" },
  people: [
    {
      id: fakeId(1),
      name: "Jan Kowalski",
      published: false,
      birthDate: "1965-03-12",
    },
  ],
  updatedAt: hoursAgo(1.2),
};

const dataUrl = (file: string) =>
  `data:image/png;base64,${readFileSync(new URL(file, import.meta.url)).toString("base64")}`;

/** `GET /api/declarations/<id>/images`: the synthetic crop, for any row.
 * Read when asked, not when the spec is listed. */
export const cropImages = () => ({
  date: dataUrl("./declaration-crop.png"),
  name: dataUrl("./declaration-crop-name.png"),
});

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

/** DERIVED: readers' answers a day for the twelve days reading has been open,
 * a launch-day peak and then a plateau: 1,012 answers, 323 crops settled
 * (312 agreed by readers, 11 unreadable). */
const ANSWERS_BY_DAY = [212, 148, 97, 85, 64, 71, 58, 66, 49, 52, 61, 49];
const SETTLED_BY_DAY = [35, 50, 37, 31, 24, 27, 21, 25, 17, 19, 22, 15];

function disputedRows(n: number): DeclarationReviewRow[] {
  return [
    OPENED_CROP,
    ...Array.from({ length: n - 1 }, (_, k): DeclarationReviewRow => {
      const i = k + 1;
      const place = unitAt(i + 2);
      const base = fakeDate(i);
      const readings =
        i % 3 === 0
          ? [
              { value: base, readers: 2 },
              { value: swapped(base), readers: 2 },
              {
                value: `${Number(base.slice(0, 4)) - 10}${base.slice(4)}`,
                readers: 1,
              },
            ]
          : i % 3 === 1
            ? [
                { value: base.slice(0, 4), readers: 2 },
                { value: fakeDate(i + 40), readers: 2 },
                { value: base, readers: 1 },
              ]
            : [
                { value: base, readers: 3 },
                { value: fakeDate(i + 17), readers: 2 },
              ];
      return {
        id: cropId(i),
        unit: place.unit,
        office: place.office,
        declarationYear: place.year,
        documentUrl: documentUrl(place.year, i),
        status: "disputed",
        readings,
        unreadable: 1,
        agreed: null,
        agreedBy: null,
        machine: i % 4 === 0 ? { birthDate: base, confidence: "low" } : null,
        people: [
          {
            id: fakeId(i * 3),
            name: fakeName(i * 3),
            published: false,
            birthDate: i % 2 === 0 ? base : null,
          },
        ],
        updatedAt: hoursAgo(1.2 + i * 3.7),
      };
    }),
  ];
}

function differentRows(n: number): DeclarationReviewRow[] {
  return Array.from({ length: n }, (_, i) => {
    const place = unitAt(i);
    const agreed = fakeDate(i + 100);
    // Most are day and month swapped on the page; every fourth is a namesake.
    const pageDate = i % 4 === 3 ? fakeDate(i + 300) : swapped(agreed);
    const readers = 2 + (i % 3);
    return {
      id: cropId(100 + i),
      unit: place.unit,
      office: place.office,
      declarationYear: place.year,
      documentUrl: documentUrl(place.year, 100 + i),
      status: "agreed",
      readings:
        i % 2 === 0
          ? [{ value: agreed, readers }]
          : [
              { value: agreed, readers: readers + 1 },
              { value: fakeDate(i + 200), readers: 1 },
            ],
      unreadable: i % 5 === 4 ? 1 : 0,
      agreed,
      agreedBy: "readers",
      machine: i % 3 === 0 ? { birthDate: null, confidence: null } : null,
      people: [
        {
          id: fakeId(500 + i),
          name: fakeName(500 + i),
          published: i % 5 === 0,
          birthDate: pageDate,
        },
      ],
      updatedAt: hoursAgo(0.8 + i * 2.9),
    };
  });
}

/** DERIVED: why the 11 held pages are held. */
const HELD_BY: { reason: PublicationHoldReason; count: number }[] = [
  { reason: "pending_proposal", count: 4 },
  { reason: "kept_hidden", count: 3 },
  { reason: "two_pages", count: 2 },
  { reason: "name_differs", count: 1 },
  { reason: "ambiguous_candidacy", count: 1 },
];

function heldRows(): DeclarationPublicationRow[] {
  return HELD_BY.flatMap(({ reason, count }) =>
    Array<PublicationHoldReason>(count).fill(reason),
  ).map((reason, i) => {
    const place = unitAt(i + 5);
    return {
      personId: fakeId(800 + i),
      name: fakeName(800 + i),
      status: "held",
      reason,
      pagePublic: false,
      at: hoursAgo(2.5 + i * 6.1),
      unit: place.unit,
      documentUrl: documentUrl(place.year, 800 + i),
      edges: { published: 0, held: 1 + (i % 4) },
      pressed: false,
    };
  });
}

/** DERIVED: the seven pages the automation published today, by the frozen
 * noon in Warsaw, newest first; `daysBack` moves them to an earlier day. */
function recentRows(daysBack = 0): DeclarationPublicationRow[] {
  const times = ["06:15", "07:15", "07:40", "08:26", "09:02", "09:31", "09:48"];
  return times
    .map((time, i) => {
      const place = unitAt(i * 3 + 1);
      const at = new Date(
        Date.parse(`${TODAY}T${time}:00.000Z`) - daysBack * 86_400_000,
      ).toISOString();
      return {
        personId: fakeId(900 + i),
        name: fakeName(900 + i),
        status: "published" as const,
        reason: null,
        pagePublic: true,
        at,
        unit: place.unit,
        documentUrl: documentUrl(place.year, 900 + i),
        edges: { published: 1 + (i % 3), held: i % 4 === 3 ? 1 : 0 },
        pressed: false,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// The overview
// ---------------------------------------------------------------------------

/**
 * REAL
 *   candidacies 3,368 on 2,159 pages: the people-mode search's site
 *     candidacies, 2026-10-29
 *   notFound no_seed 127: site candidacies in the 92 units with no BIP or
 *     website to start from
 *   extracts 1,070: the prototype run's queued declarations, 151 of them
 *     without a crop (64 blank Word forms, 29 blank fields, 29 with no date
 *     line, 27 scans saved as Word, 2 not fetched)
 *   dailyLimit 10: DAILY_AUTO_PUBLISH_LIMIT
 * DERIVED
 *   candidacies by status, the other not-found reasons: split by guess
 *   extracts by status: of 911 to read, readers settled 312 + 11
 *     unreadable, 14 disputed, 2 withdrawn, 572 open
 *   pages: of 314 agreed days, 178 pages without a date (58.6%, as 897 of
 *     1,530 winners' drafts), 116 the same (22 of them already public), 20
 *     different
 *   publications: 74 published over 11 days at no more than 10 a day, 7 of
 *     them today; 9 queued; 11 held
 */
export const declarationOverview: DeclarationOverview = {
  at: hoursAgo(5 / 60),
  dailyLimit: 10,
  candidacies: {
    total: 3368,
    people: 2159,
    byStatus: { pending: 412, found: 1212, unconfirmed: 187, not_found: 1557 },
    notFound: [
      { reason: "no_declarations", count: 611 },
      { reason: "not_listed", count: 402 },
      { reason: "unreachable", count: 214 },
      { reason: "no_seed", count: 127 },
      { reason: "robots", count: 96 },
      { reason: "timeout", count: 58 },
      { reason: "download_failed", count: 31 },
      { reason: "error", count: 18 },
    ],
  },
  extracts: {
    total: 1070,
    byStatus: {
      open: 572,
      agreed: 320,
      unreadable: 11,
      disputed: 14,
      failed: 151,
      withdrawn: 2,
    },
    failed: [
      { reason: "blank_form", count: 64 },
      { reason: "blank_field", count: 29 },
      { reason: "no_date_line", count: 29 },
      { reason: "scan_in_word", count: 27 },
      { reason: "not_fetched", count: 2 },
    ],
  },
  readers: {
    answers: 1012,
    readers: 37,
    days: days(TODAY, 30).map((day, i) => ({
      day,
      answers: ANSWERS_BY_DAY[i - 18] ?? 0,
      settled: SETTLED_BY_DAY[i - 18] ?? 0,
    })),
  },
  pages: { same: 94, different: 20, noDate: 178, confirmed: 22 },
  publications: {
    queued: 9,
    published: 74,
    held: 11,
    today: 7,
    heldBy: HELD_BY,
  },
  lists: {
    disputed: disputedRows(14),
    different: differentRows(20),
    held: heldRows(),
    recent: recentRows(),
  },
  runs: [
    {
      tag: "bip-cut-v1",
      runId: `${TODAY.replaceAll("-", "")}T020000Z`,
      extracts: 42,
      at: hoursAgo(7.5),
    },
    {
      tag: "bip-cut-v1",
      runId: `${days(TODAY, 2)[0]!.replaceAll("-", "")}T020000Z`,
      extracts: 17,
      at: hoursAgo(31.6),
    },
    // The first run, the morning reading opened.
    {
      tag: "bip-cut-v1",
      runId: `${days(TODAY, 12)[0]!.replaceAll("-", "")}T050000Z`,
      extracts: 1011,
      at: hoursAgo(11 * 24 + 2.5),
    },
  ],
};

/** The same day with the automatic publication switched off (limit 0): none
 * today, the last ones yesterday, and 83 waiting. */
export const declarationOverviewOff: DeclarationOverview = {
  ...declarationOverview,
  dailyLimit: 0,
  publications: { ...declarationOverview.publications, queued: 83, today: 0 },
  lists: { ...declarationOverview.lists, recent: recentRows(1) },
};

/** Right after the deploy, before the job's first upload, and with the
 * automatic publication still switched off, as it ships. */
export const declarationOverviewEmpty: DeclarationOverview = {
  at: hoursAgo(1 / 60),
  dailyLimit: 0,
  candidacies: {
    total: 0,
    people: 0,
    byStatus: { pending: 0, found: 0, unconfirmed: 0, not_found: 0 },
    notFound: [],
  },
  extracts: {
    total: 0,
    byStatus: {
      open: 0,
      agreed: 0,
      unreadable: 0,
      disputed: 0,
      failed: 0,
      withdrawn: 0,
    },
    failed: [],
  },
  readers: {
    answers: 0,
    readers: 0,
    days: days(TODAY, 30).map((day) => ({ day, answers: 0, settled: 0 })),
  },
  pages: { same: 0, different: 0, noDate: 0, confirmed: 0 },
  publications: { queued: 0, published: 0, held: 0, today: 0, heldBy: [] },
  lists: { disputed: [], different: [], held: [], recent: [] },
  runs: [],
};

// ---------------------------------------------------------------------------
// The person's page
// ---------------------------------------------------------------------------

/** The seeded Jan Kowalski (scripts/nodes.json), who is published. The seed
 * gives him no birth date, and a declaration only ever confirms a page that
 * has one, so his `/api/nodes/1` answer gets this one laid over it. */
export const declarationPerson = {
  id: "1",
  path: "/osoba/jan-kowalski-1",
  birthDate: "1968-03-14",
};

const STRZELIN = "Strzelin (gmina miejsko-wiejska)";

const declaration2024 = {
  url: "https://bip.example.pl/oswiadczenia-majatkowe/2024/oswiadczenie-majatkowe-radnego-za-2024.pdf",
  year: 2024,
  unit: STRZELIN,
  office: "Rada gminy" as const,
};

/** Published by the automation at 09:15 in Warsaw on the frozen day, two
 * declarations, older first as the endpoint may send them. */
export const personDeclarations: PersonDeclarations = {
  autoPublished: { at: `${TODAY}T07:15:00.000Z` },
  declarations: [
    {
      url: "https://bip.example.pl/oswiadczenia-majatkowe/2023/oswiadczenie-majatkowe-radnego-za-2023.pdf",
      year: 2023,
      unit: STRZELIN,
      office: "Rada gminy",
    },
    declaration2024,
  ],
};

/** A page somebody published by hand before readers confirmed its date: the
 * declaration is linked, nothing was published automatically. */
export const personDeclarationsByHand: PersonDeclarations = {
  autoPublished: null,
  declarations: [declaration2024],
};

/** Two articles that name him; the seed has none. */
export const personMentions: NodeMentions = {
  mentions: [
    {
      edgeId: "wzmianka1",
      nodeId: "artykul1",
      name: "Radny z dwiema posadami w spółkach miejskich",
      sourceURL: "https://www.example-gazeta.pl/radny-dwie-posady",
      publishedDate: "2025-03-14T00:00:00.000Z",
      published: true,
    },
    {
      edgeId: "wzmianka2",
      nodeId: "artykul2",
      name: "Kto zasiada w radzie nadzorczej wodociągów",
      sourceURL: "https://example-portal.pl/rada-nadzorcza-wodociagi",
      publishedDate: "2024-11-02T00:00:00.000Z",
      published: true,
    },
  ],
};

/** What a favicon request gets: a plain grey square, so the cards do not wait
 * on google.com, which the suite never reaches for anything else. */
export const PLAIN_FAVICON = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42u3NQQkAAAgEsOufTwTbmMKHMNh/6alTEQgEAoFAIBAIBF+CBWX0DJfeNQ8nAAAAAElFTkSuQmCC",
  "base64",
);
