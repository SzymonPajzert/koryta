/**
 * How far the declarations got, in people: the rules that put each person in
 * one stage, and the snapshot drawn from them (`DeclarationPeople`).
 *
 * Pure, without Firestore, so the count of the night's facts, the re-staging
 * of the people a daytime event touches (server/utils/declarationPeopleCount.ts)
 * and a check against an export all read the same rules.
 *
 * Who is counted (decision on 2026-11-15): the pages of the night's list with
 * a public post (`pagesWithAPublicPost`), the only kind a declaration
 * publishes: the drafts, and the pages a declaration published. A page made
 * public some other way is left out, and so is one a declaration published
 * without a public post (decision on 2026-11-17).
 *
 * Each person is in the first stage that holds, so the stages add up:
 *
 * 1. published: a declaration published the page.
 * 2. held: a settled reading has the page's birth date and the page waits,
 *    for its slot of the day or for an admin.
 * 3. namesakes, mismatched: a settled reading has another birth date
 *    (`differentKind` tells which).
 * 4. held: a date read for a page without one (`no_date`).
 * 5. reading: a crop of theirs is on the site and nobody has settled it.
 * 6. cropped: predator cut a crop of theirs the site does not have yet.
 * 7. downloaded: a file of theirs came down and is not cut yet.
 * 8. searching: no date to read yet, and why (`peopleSearchReasons`). A
 *    council's file that names nobody counts for a person only through a
 *    page with their name on it.
 *
 * Stages 6 and 7 are predator's word when it wrote the facts (`partAt`): a
 * crop of the candidacy that reached the site after that says it is behind.
 *
 * Whether `queued` becomes a stage of its own is open: it is held, with the
 * publication's status kept as the detail.
 */
import { z } from "zod";
import { isoDay, warsawDate } from "./dates";
import {
  candidacyStatuses,
  extractStatuses,
  pageOutcomes,
  peopleSearchReasons,
  peopleStages,
  publicationStatuses,
  type DeclarationFact,
  type DeclarationPeople,
  type DrainResult,
  type ExtractStatus,
  type PageOutcome,
  type PeopleSearchReason,
  type PeopleStage,
  type PublicationStatus,
  type SweepResult,
} from "./declarations";

/** The crawl's not_found reasons that mean the BIP would not let it through,
 * in the order one is named when a person's candidacies give several. */
export const BIP_REASONS = [
  "unreachable",
  "refused",
  "robots",
  "throttled",
  "timeout",
  "download_failed",
  "budget",
  "no_seed",
] as const satisfies readonly PeopleSearchReason[];

/** A search that went through and found no declaration of theirs. */
export const ABSENT_REASONS = [
  "not_listed",
  "no_declarations",
] as const satisfies readonly PeopleSearchReason[];

/** The stages of the people whose date somebody has read: what the namesake
 * rate is learnt from. The rest are what it is applied to. */
const SETTLED: ReadonlySet<PeopleStage> = new Set([
  "published",
  "held",
  "namesakes",
  "mismatched",
]);

/** Bands of surname bearers the namesake estimate works in: the share of
 * namesakes climbs with how common a surname is, from none under 50 bearers
 * to nearly half at 20,000 and over (measured on 2026-11-14). */
export const BANDS: readonly (readonly [number, number | null])[] = [
  [0, 50],
  [50, 1_000],
  [1_000, 5_000],
  [5_000, 20_000],
  [20_000, null],
];

/** Settled people a band needs before its rate is applied to anybody. */
export const MIN_SETTLED = 20;
const BOOTSTRAP = 1000;
const SEED = 3;
const TOP_UNITS = 8;
/** `publishedByDay` takes this many days at most. */
const MAX_DAYS = 400;
/** The youngest a councillor can be: a birth year later than this many years
 * back is the date the form was signed, typed where the birth date goes. */
const ADULT = 18;

// ---------------------------------------------------------------------------
// What the count reads
// ---------------------------------------------------------------------------

/** A candidacy as a person's entry keeps it: the night's fact without the
 * pages and the surname count. */
export const peopleCandidacySchema = z
  .object({
    key: z.string(),
    teryt: z.string(),
    unitName: z.string(),
    year: z.number(),
    status: z.enum(candidacyStatuses),
    reason: z.string(),
    uncut: z.boolean(),
    cutNamed: z.boolean(),
    waiting: z.boolean(),
  })
  .strict();
export type PeopleCandidacy = z.infer<typeof peopleCandidacySchema>;

/** One counted person, as `declarationPeople/shard-<n>` keeps them under their
 * page id: what re-staging them needs, and no names.
 *
 * Strict: prod and autopush both write these, on releases of their own, so an
 * entry with a field or a stage this release has no word for is a newer
 * one's, and it must not read as one this release can rewrite. */
export const personEntrySchema = z
  .object({
    stage: z.enum(peopleStages),
    /** Why a searching person has no date (`peopleSearchReasons`); where a
     * held page waits. */
    detail: z.string(),
    /** Index into `BANDS`. */
    band: z
      .number()
      .int()
      .min(0)
      .max(BANDS.length - 1),
    /** The Warsaw day a declaration published the page. */
    publishedOn: z.string().nullable(),
    /** The unit the person is counted under: the one whose search gave the
     * reason, else the newest candidacy's. */
    unit: z.string(),
    unitName: z.string(),
    keys: z.array(z.string()),
    candidacies: z.array(peopleCandidacySchema).min(1),
    /** When the reads it was staged from began, in ms: an older staging never
     * replaces a newer one. */
    at: z.number(),
  })
  .strict();
export type PersonEntry = z.infer<typeof personEntrySchema>;

/** A crop as the count reads it off `declarationExtracts`. */
export type CropRecord = {
  status: ExtractStatus | null;
  personIds: string[];
  /** What a settled reading said of each page, by the id it named. */
  pageOutcomes: ReadonlyMap<string, PageOutcome | null>;
  /** The settled reading, YYYY-MM-DD or YYYY. */
  value: string | null;
  candidacyKeys: string[];
  /** When it first reached the site, in ms. */
  createdAt: number | null;
};

/** One crop of a page: where its reading stands, and what a settled one said
 * of the page. */
export type PageCrop = {
  status: ExtractStatus | null;
  outcome: PageOutcome | null;
  value: string | null;
};

/** A page's `declarationPublications` record. */
export type PublicationState = {
  status: PublicationStatus;
  reason: string | null;
  /** The Warsaw day it was published. */
  publishedOn: string | null;
};

/** What the site knows of one person's page. */
export type PageState = {
  publication: PublicationState | null;
  crops: readonly PageCrop[];
  /** The page's birth date, trimmed (`pageBirthDate`). */
  birthDate: string;
  /** A crop on the site for one of their candidacies names other pages only. */
  elsewhere: boolean;
  /** Their candidacy keys a crop reached the site for after predator wrote
   * the facts (`arrivedSince`). */
  arrived: ReadonlySet<string>;
};

/** The node fields the count reads, once followed through merges. */
export type PageNode = {
  type?: unknown;
  published?: unknown;
  birthDate?: unknown;
  merged_into?: unknown;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
}

function isExtractStatus(value: unknown): value is ExtractStatus {
  return (extractStatuses as readonly unknown[]).includes(value);
}

function isPageOutcome(value: unknown): value is PageOutcome {
  return (pageOutcomes as readonly unknown[]).includes(value);
}

export function isPublicationStatus(
  value: unknown,
): value is PublicationStatus {
  return (publicationStatuses as readonly unknown[]).includes(value);
}

function isSearchReason(value: string): value is PeopleSearchReason {
  return (peopleSearchReasons as readonly string[]).includes(value);
}

function isBipReason(value: string): boolean {
  return (BIP_REASONS as readonly string[]).includes(value);
}

/** A stored instant in ms: a Firestore Timestamp, a Date or ISO text. */
export function millisOf(value: unknown): number | null {
  const stamp = value as { toMillis?: unknown; toDate?: unknown } | null;
  const ms =
    stamp && typeof stamp.toMillis === "function"
      ? Number((stamp as { toMillis(): number }).toMillis())
      : stamp && typeof stamp.toDate === "function"
        ? (stamp as { toDate(): Date }).toDate().getTime()
        : value instanceof Date
          ? value.getTime()
          : typeof value === "string"
            ? Date.parse(value)
            : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** A crop's stored fields as the count reads them. A status or an outcome the
 * site has no word for counts as none, and so does what a crop said of its
 * pages once it is not a full date agreed on: only that is compared with
 * pages (`agreedDay` in server/utils/declarationPublish.ts), and a crop taken
 * back, found unreadable or settled on a year alone keeps what it said
 * before. */
export function cropRecordOf(
  data: Record<string, unknown> | undefined,
): CropRecord {
  const status = isExtractStatus(data?.status) ? data.status : null;
  const agreed = data?.agreed as { value?: unknown } | null | undefined;
  const value =
    agreed && typeof agreed === "object" && typeof agreed.value === "string"
      ? agreed.value
      : "";
  const compared = status === "agreed" && isoDay(value) !== null;
  const outcomes = new Map<string, PageOutcome | null>();
  const stored = data?.pageOutcomes;
  if (stored && typeof stored === "object") {
    for (const [page, outcome] of Object.entries(stored)) {
      outcomes.set(page, compared && isPageOutcome(outcome) ? outcome : null);
    }
  }
  return {
    status,
    personIds: strings(data?.personIds),
    pageOutcomes: outcomes,
    value: value || null,
    candidacyKeys: strings(data?.candidacyKeys),
    createdAt: millisOf(data?.createdAt),
  };
}

/** The pages a crop names, as stored: its people and the pages a settled
 * reading said something of. */
export function pagesNamedBy(crop: CropRecord): string[] {
  return [...new Set([...crop.personIds, ...crop.pageOutcomes.keys()])];
}

/** The page's birth date as the site compares it (`birthDateOf` in
 * server/utils/declarationPublish.ts). */
export function pageBirthDate(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type CropIndex = {
  /** What the crops say of each page they name, followed through merges. */
  byPage: Map<string, PageCrop[]>;
  /** The pages each crop names, followed through merges, by the candidacy
   * keys it holds. */
  byKey: Map<string, ReadonlySet<string>[]>;
  /** When the newest crop of each candidacy key reached the site, in ms. */
  arrived: Map<string, number>;
};

/** The crops by the pages they name and by their candidacy keys, a page
 * followed to the one it was merged into. */
export function indexCrops(
  crops: Iterable<CropRecord>,
  resolve: (page: string) => string,
): CropIndex {
  const index: CropIndex = {
    byPage: new Map(),
    byKey: new Map(),
    arrived: new Map(),
  };
  for (const crop of crops) {
    const named = new Set<string>();
    for (const page of pagesNamedBy(crop)) {
      const final = resolve(page);
      named.add(final);
      const list = index.byPage.get(final) ?? [];
      list.push({
        status: crop.status,
        outcome: crop.pageOutcomes.get(page) ?? null,
        value: crop.value,
      });
      index.byPage.set(final, list);
    }
    for (const key of new Set(crop.candidacyKeys)) {
      const list = index.byKey.get(key) ?? [];
      list.push(named);
      index.byKey.set(key, list);
      if (
        crop.createdAt !== null &&
        crop.createdAt > (index.arrived.get(key) ?? -Infinity)
      ) {
        index.arrived.set(key, crop.createdAt);
      }
    }
  }
  return index;
}

/** The keys a crop reached the site for after `since`, when predator wrote
 * the facts: they said a crop of the candidacy waits, or a file of it is not
 * cut, and the crop is it. A key with several waiting may move early, until
 * the next night's facts. */
export function arrivedSince(
  keys: readonly string[],
  index: CropIndex,
  since: number,
): Set<string> {
  return new Set(
    keys.filter((key) => (index.arrived.get(key) ?? -Infinity) > since),
  );
}

/** Whether a crop on the site for one of the keys names other pages only: the
 * person's name was read on another page of the file (`other_page`). */
export function namedElsewhere(
  page: string,
  keys: readonly string[],
  index: CropIndex,
): boolean {
  return keys.some(
    (key) => index.byKey.get(key)?.some((named) => !named.has(page)) ?? false,
  );
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

function unreachable(value: never): never {
  throw new Error(`unexpected value ${String(value)}`);
}

/** What a settled reading said of a page, as the stages group it. */
function outcomeKind(
  outcome: PageOutcome,
): "matched" | "different" | "no_date" {
  switch (outcome) {
    case "queued":
    case "held":
    case "confirmed":
      return "matched";
    case "different":
      return "different";
    case "no_date":
      return "no_date";
    default:
      return unreachable(outcome);
  }
}

/** Where a crop's reading stands, as the stages group it. */
function readingOf(
  status: ExtractStatus,
): "open" | "agreed" | "unreadable" | "withdrawn" | "failed" {
  switch (status) {
    case "open":
    case "disputed":
      return "open";
    case "agreed":
      return "agreed";
    case "unreadable":
      return "unreadable";
    case "withdrawn":
      return "withdrawn";
    case "failed":
      return "failed";
    default:
      return unreachable(status);
  }
}

/** Where a held page waits: its publication's status, a hold's reason, or
 * `unrecorded` where nothing was recorded. */
function heldDetail(publication: PublicationState | null): string {
  if (!publication) return "unrecorded";
  const { status } = publication;
  switch (status) {
    case "held":
      return publication.reason ? `held:${publication.reason}` : status;
    case "queued":
    case "publishing":
    case "published":
    case "confirmed":
      return status;
    default:
      return unreachable(status);
  }
}

/**
 * `namesake` or `mismatched`: what a settled date other than the page's
 * birth date most likely is.
 *
 * A few years off, or the same year with the day and month far apart, is
 * another person's date: a namesake. A digit or two off in the same year, the
 * same day and month in another year, a year a councillor cannot be born in
 * (the date the form was signed) or one ten years and more off (another file)
 * is a misreading or a wrong file, for an admin. A year read alone that is not
 * the page's is a namesake.
 */
export function differentKind(
  read: string,
  page: string,
  thisYear: number,
): "namesake" | "mismatched" {
  const digits = /^\d{4}$/;
  if (read.length < 4 || !digits.test(read.slice(0, 4))) return "mismatched";
  const year = Number(read.slice(0, 4));
  if (year > thisYear - ADULT) return "mismatched";
  if (read.length === 4) return "namesake";
  if (page.length < 10 || !digits.test(page.slice(0, 4))) return "mismatched";
  const pageYear = Number(page.slice(0, 4));
  if (year === pageYear) {
    let slips = 0;
    for (let i = 0; i < Math.min(read.length, page.length); i++) {
      if (read[i] !== page[i]) slips += 1;
    }
    return slips <= 2 ? "mismatched" : "namesake";
  }
  if (read.slice(4) === page.slice(4)) return "mismatched";
  return Math.abs(year - pageYear) < 10 ? "namesake" : "mismatched";
}

/** The newest candidacy: the latest election, then the smallest key. */
export function newest<T extends { year: number; key: string }>(
  rows: readonly T[],
): T {
  const [first, ...rest] = rows;
  if (!first) throw new Error("a person counted without a candidacy");
  return rest.reduce(
    (best, row) =>
      row.year > best.year || (row.year === best.year && row.key < best.key)
        ? row
        : best,
    first,
  );
}

/** Why the search found no declaration of theirs, and the candidacy that says
 * so: the BIP not letting the crawler through before a search that found
 * nothing, else nothing tried yet. Files that came down without a link naming
 * them (`unconfirmed`), none of whose pages is theirs, are a search that found
 * nothing of theirs: `not_listed`.
 *
 * A not_found reason the site has no word for counts as nothing tried yet, and
 * is listed in `unknown` for the night to report. */
export function searchReason(candidacies: readonly PeopleCandidacy[]): {
  reason: PeopleSearchReason;
  from: PeopleCandidacy;
  unknown: string[];
} {
  const byKey = [...candidacies].sort((a, b) => compare(a.key, b.key));
  const notFound = byKey.filter((row) => row.status === "not_found");
  const unknown = notFound
    .map((row) => row.reason)
    .filter((reason) => !isSearchReason(reason));
  for (const reason of [...BIP_REASONS, ...ABSENT_REASONS]) {
    const from = notFound.find((row) => row.reason === reason);
    if (from) return { reason, from, unknown };
  }
  const unconfirmed = byKey.find((row) => row.status === "unconfirmed");
  if (unconfirmed) return { reason: "not_listed", from: unconfirmed, unknown };
  return { reason: "pending", from: newest(candidacies), unknown };
}

/** The person's stage and its detail, the first stage that holds (see the top
 * of this file). */
export function stageOf(
  input: PageState & {
    candidacies: readonly PeopleCandidacy[];
    thisYear: number;
  },
): { stage: PeopleStage; detail: string } {
  const { publication, crops, candidacies } = input;
  if (publication?.status === "published") {
    return { stage: "published", detail: "" };
  }
  const kinds = crops.map((crop) =>
    crop.outcome ? outcomeKind(crop.outcome) : null,
  );
  if (kinds.includes("matched")) {
    return { stage: "held", detail: heldDetail(publication) };
  }
  const readings = new Set(
    crops.flatMap((crop, i) =>
      kinds[i] === "different" && crop.value
        ? [differentKind(crop.value, input.birthDate, input.thisYear)]
        : [],
    ),
  );
  if (readings.size > 0) {
    // One namesake's date is enough: a misread or wrong file beside it does
    // not make the page the councillor's.
    return {
      stage: readings.has("namesake") ? "namesakes" : "mismatched",
      detail: "",
    };
  }
  if (kinds.includes("no_date")) {
    // A date read for a page without one: nothing to compare it with until a
    // reviewer takes the register's date the pipeline proposes.
    return { stage: "held", detail: "no_date" };
  }
  const states = new Set(
    crops.flatMap((crop) => (crop.status ? [readingOf(crop.status)] : [])),
  );
  if (
    states.has("open") ||
    crops.some((crop) => crop.status === "agreed" && !crop.outcome)
  ) {
    return { stage: "reading", detail: "" };
  }
  // Predator's facts, for the candidacies no crop reached the site for since.
  const current = candidacies.filter((row) => !input.arrived.has(row.key));
  if (current.some((row) => row.waiting)) {
    return { stage: "cropped", detail: "" };
  }
  if (current.some((row) => row.uncut)) {
    return { stage: "downloaded", detail: "" };
  }
  if (states.has("unreadable")) {
    return { stage: "searching", detail: "unreadable" };
  }
  if (states.has("withdrawn") || input.elsewhere) {
    return { stage: "searching", detail: "other_page" };
  }
  if (states.has("failed") || candidacies.some((row) => row.cutNamed)) {
    return { stage: "searching", detail: "no_date_line" };
  }
  return { stage: "searching", detail: searchReason(candidacies).reason };
}

/** The band of `BANDS` a surname with this many bearers falls in. */
export function bandOf(bearers: number): number {
  return BANDS.findIndex(([, high]) => high === null || bearers < high);
}

/** A person's entry: their stage, and what re-staging them needs. */
export function stagePerson(args: {
  candidacies: readonly PeopleCandidacy[];
  band: number;
  page: PageState;
  now: Date;
  /** When the reads behind `page` began, in ms. */
  at: number;
}): { entry: PersonEntry; unknownReasons: string[] } {
  const { candidacies, page } = args;
  const { stage, detail } = stageOf({
    ...page,
    candidacies,
    thisYear: args.now.getUTCFullYear(),
  });
  const search = stage === "searching" ? searchReason(candidacies) : null;
  const unit = search?.from ?? newest(candidacies);
  return {
    entry: {
      stage,
      detail,
      band: args.band,
      publishedOn:
        stage === "published" ? (page.publication?.publishedOn ?? null) : null,
      unit: unit.teryt,
      unitName: unit.unitName,
      keys: [...new Set(candidacies.map((row) => row.key))].sort(compare),
      candidacies: [...candidacies],
      at: args.at,
    },
    unknownReasons: search?.unknown ?? [],
  };
}

/** Whether the node is a person's page that is not merged into another. */
export function isPersonPage(node: PageNode | undefined): node is PageNode {
  return (
    node?.type === "person" &&
    !(typeof node.merged_into === "string" && node.merged_into)
  );
}

/** A page made public some other way than by a declaration: a declaration has
 * nothing left to do there. */
export function publicOtherwise(
  node: PageNode,
  publication: PublicationState | null,
): boolean {
  return node.published === true && publication?.status !== "published";
}

/** A fact as an entry keeps it. */
export function candidacyOf(fact: DeclarationFact): PeopleCandidacy {
  return {
    key: fact.key,
    teryt: fact.teryt,
    unitName: fact.unitName,
    year: fact.year,
    status: fact.status,
    reason: fact.reason,
    uncut: fact.uncut,
    cutNamed: fact.cutNamed,
    waiting: fact.waiting,
  };
}

/** The night's facts by the page each kid resolves to, each candidacy once a
 * page, the pages in order. */
export function factsByPage(
  facts: readonly DeclarationFact[],
  resolve: (page: string) => string,
): Map<string, DeclarationFact[]> {
  const byPage = new Map<string, Map<string, DeclarationFact>>();
  for (const fact of facts) {
    for (const kid of fact.kids) {
      const page = resolve(kid);
      const rows = byPage.get(page) ?? new Map<string, DeclarationFact>();
      if (!rows.has(fact.key)) rows.set(fact.key, fact);
      byPage.set(page, rows);
    }
  }
  return new Map(
    [...byPage]
      .sort(([a], [b]) => compare(a, b))
      .map(([page, rows]) => [page, [...rows.values()]]),
  );
}

export type PeopleCount = {
  entries: Map<string, PersonEntry>;
  /** The list's pages left out, and why. */
  leftOut: { gone: number; noPublicPost: number; publicOtherwise: number };
  /** not_found reasons the site has no word for, by the candidacies of the
   * people still searching that carry them. */
  unknownReasons: Record<string, number>;
};

/** Everybody the list and the site say a declaration can publish, each in one
 * stage. */
export function countPeople(args: {
  byPage: ReadonlyMap<string, readonly DeclarationFact[]>;
  /** Nodes by the page they resolve to; a page that is gone is absent. */
  nodes: ReadonlyMap<string, PageNode>;
  publicPosts: ReadonlySet<string>;
  /** Records by the page they resolve to. */
  publications: ReadonlyMap<string, PublicationState>;
  crops: CropIndex;
  /** When predator wrote the facts, in ms (`partAt`). */
  factsAt: number;
  now: Date;
}): PeopleCount {
  const entries = new Map<string, PersonEntry>();
  const leftOut = { gone: 0, noPublicPost: 0, publicOtherwise: 0 };
  const unknown = new Map<string, number>();
  for (const [page, facts] of args.byPage) {
    const node = args.nodes.get(page);
    if (!isPersonPage(node)) {
      leftOut.gone += 1;
      continue;
    }
    if (!args.publicPosts.has(page)) {
      leftOut.noPublicPost += 1;
      continue;
    }
    const publication = args.publications.get(page) ?? null;
    if (publicOtherwise(node, publication)) {
      leftOut.publicOtherwise += 1;
      continue;
    }
    const candidacies = facts.map(candidacyOf);
    const keys = candidacies.map((row) => row.key);
    const { entry, unknownReasons } = stagePerson({
      candidacies,
      // The newest candidacy names the person.
      band: bandOf(newest(facts).bearers),
      page: {
        publication,
        crops: args.crops.byPage.get(page) ?? [],
        birthDate: pageBirthDate(node.birthDate),
        elsewhere: namedElsewhere(page, keys, args.crops),
        arrived: arrivedSince(keys, args.crops, args.factsAt),
      },
      now: args.now,
      at: args.now.getTime(),
    });
    entries.set(page, entry);
    for (const reason of unknownReasons) {
      unknown.set(reason, (unknown.get(reason) ?? 0) + 1);
    }
  }
  return { entries, leftOut, unknownReasons: Object.fromEntries(unknown) };
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

type Counted = Pick<
  PersonEntry,
  "stage" | "detail" | "band" | "publishedOn" | "unit" | "unitName"
> & { page: string };

/** A seeded generator, so the same people give the same interval. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The q-th percentile of sorted values, interpolated linearly between the
 * two nearest, as numpy does by default. */
function percentile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * (q / 100);
  const below = Math.floor(at);
  const a = sorted[below] ?? 0;
  const b = sorted[Math.min(below + 1, sorted.length - 1)] ?? a;
  const t = at - below;
  return t >= 0.5 ? b - (b - a) * (1 - t) : a + (b - a) * t;
}

/** Rounds half to even, as Python's `round` does. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** The settled people by how common their surname is and how many of them
 * turned out namesakes, and the namesakes to expect among the rest: each
 * band's share applied to the people in it whose date nobody has read, with a
 * 90% interval from resampling the settled, in page order. Null when a band
 * with people to apply it to has too few settled to say. */
export function namesakeEstimate(
  people: readonly Pick<Counted, "page" | "stage" | "band">[],
  seed: number = SEED,
): Pick<DeclarationPeople, "bySurname" | "expectedNamesakes"> {
  const sorted = [...people].sort((a, b) => compare(a.page, b.page));
  const settled = sorted.filter((p) => SETTLED.has(p.stage));
  const zeros = () => BANDS.map(() => 0);
  const remaining = zeros();
  for (const p of sorted) {
    if (!SETTLED.has(p.stage)) remaining[p.band] = (remaining[p.band] ?? 0) + 1;
  }
  const tally = (sample: readonly number[]) => {
    const seen = zeros();
    const namesakes = zeros();
    for (const i of sample) {
      const p = settled[i]!;
      seen[p.band] = (seen[p.band] ?? 0) + 1;
      if (p.stage === "namesakes") {
        namesakes[p.band] = (namesakes[p.band] ?? 0) + 1;
      }
    }
    return { seen, namesakes };
  };
  const all = settled.map((_, i) => i);
  const { seen, namesakes } = tally(all);
  const bySurname = BANDS.map(([min, max], i) => ({
    min,
    max,
    settled: seen[i] ?? 0,
    namesakes: namesakes[i] ?? 0,
    remaining: remaining[i] ?? 0,
  }));
  if (
    BANDS.some(
      (_, i) => (remaining[i] ?? 0) > 0 && (seen[i] ?? 0) < MIN_SETTLED,
    )
  ) {
    return { bySurname, expectedNamesakes: null };
  }
  // Summed band by band from 0, the way numpy sums five numbers.
  const expected = (sample: readonly number[]) => {
    const counts = tally(sample);
    let total = 0;
    BANDS.forEach((_, i) => {
      const n = counts.seen[i] ?? 0;
      const share = n > 0 ? (counts.namesakes[i] ?? 0) / n : 0;
      total += share * (remaining[i] ?? 0);
    });
    return total;
  };
  const point = expected(all);
  if (settled.length === 0) {
    return { bySurname, expectedNamesakes: { count: 0, low: 0, high: 0 } };
  }
  const random = mulberry32(seed);
  const draws: number[] = [];
  for (let d = 0; d < BOOTSTRAP; d++) {
    const sample = settled.map(() => Math.floor(random() * settled.length));
    draws.push(expected(sample));
  }
  draws.sort((a, b) => a - b);
  return {
    bySurname,
    expectedNamesakes: {
      count: roundHalfEven(point),
      low: roundHalfEven(percentile(draws, 5)),
      high: roundHalfEven(percentile(draws, 95)),
    },
  };
}

/** The units with the most people whose BIP would not let the crawler
 * through, each with the reason most of them have. */
function topUnits(people: readonly Counted[]): DeclarationPeople["topUnits"] {
  const byUnit = new Map<string, Counted[]>();
  for (const p of people) {
    if (p.stage !== "searching" || !isBipReason(p.detail)) continue;
    if (!/^\d{6}$/.test(p.unit)) continue;
    byUnit.set(p.unit, [...(byUnit.get(p.unit) ?? []), p]);
  }
  return [...byUnit]
    .sort(([a, x], [b, y]) => y.length - x.length || compare(a, b))
    .slice(0, TOP_UNITS)
    .map(([teryt, members]) => {
      const count = (reason: string) =>
        members.filter((p) => p.detail === reason).length;
      const reason = [...BIP_REASONS].sort(
        (a, b) =>
          count(b) - count(a) ||
          BIP_REASONS.indexOf(a) - BIP_REASONS.indexOf(b),
      )[0]!;
      const name = members.find((p) => p.unitName)?.unitName || teryt;
      return {
        teryt,
        name: name.slice(0, 200),
        people: members.length,
        reason,
      };
    });
}

/** The site's `DeclarationPeople`, from every person's entry. */
export function peopleSnapshot(
  entries: Iterable<readonly [string, PersonEntry]>,
  now: Date,
  seed: number = SEED,
): DeclarationPeople {
  const people: Counted[] = [...entries]
    .map(([page, entry]) => ({ ...entry, page }))
    .sort((a, b) => compare(a.page, b.page));
  const stages = Object.fromEntries(
    peopleStages.map((stage) => [
      stage,
      people.filter((p) => p.stage === stage).length,
    ]),
  ) as Record<PeopleStage, number>;
  const searching = new Map<PeopleSearchReason, number>();
  const days = new Map<string, number>();
  for (const p of people) {
    if (p.stage === "searching" && isSearchReason(p.detail)) {
      searching.set(p.detail, (searching.get(p.detail) ?? 0) + 1);
    }
    if (p.stage === "published" && p.publishedOn) {
      days.set(p.publishedOn, (days.get(p.publishedOn) ?? 0) + 1);
    }
  }
  const reasonOrder = (reason: PeopleSearchReason) =>
    peopleSearchReasons.indexOf(reason);
  return {
    at: now.toISOString(),
    exportDay: warsawDate(now),
    people: people.length,
    ...stages,
    searchingBy: [...searching]
      .sort(([a, x], [b, y]) => y - x || reasonOrder(a) - reasonOrder(b))
      .map(([reason, count]) => ({ reason, count })),
    ...namesakeEstimate(people, seed),
    topUnits: topUnits(people),
    publishedByDay: [...days]
      .sort(([a], [b]) => compare(a, b))
      .slice(-MAX_DAYS)
      .map(([day, count]) => ({ day, count })),
  };
}

/** The pages a comparison, a pass over the queue or a sweep touched: what the
 * re-staging after it is given. */
export function pagesTouched(parts: {
  matched?: readonly { outcomes?: Readonly<Record<string, unknown>> }[];
  drain?: Partial<
    Pick<DrainResult, "published" | "held" | "confirmed" | "failed">
  >;
  reverted?: Partial<SweepResult["reverted"]>;
}): string[] {
  const { matched, drain, reverted } = parts;
  return [
    ...new Set([
      ...(matched ?? []).flatMap((match) => Object.keys(match.outcomes ?? {})),
      ...(drain?.published ?? []),
      ...(drain?.held ?? []).map((held) => held.personId),
      ...(drain?.confirmed ?? []),
      ...(drain?.failed ?? []),
      ...(reverted?.restored ?? []),
      ...(reverted?.held ?? []).map((held) => held.personId),
    ]),
  ];
}
