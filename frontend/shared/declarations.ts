/**
 * Birth dates read off BIP asset declarations (oświadczenia majątkowe).
 *
 * A job on predator finds the declarations of people the site has a page for,
 * cuts the handwritten "urodzony(a) ..." line out of each one and uploads the
 * crop through `/api/ingest/declarations`. Readers type what the crop says on
 * /oswiadczenia, signed in or not; once enough readers whose answers count
 * agree, the site compares the reading with the birth date the page already
 * stores, and a draft whose date matches is published automatically, a few a
 * day.
 *
 * The declaration is evidence against the register, so nothing on the BIP
 * side ever carries a date the site already knows: not the upload, not the
 * reading task. The two meet only on the server, never in what a reader is
 * shown before typing. Readers read blind.
 */
import { z } from "zod";
import { isoDay } from "./dates";
import { pageIsPublic } from "./model";
import { normalizePersonName } from "./names";
import { isAutomatedUid } from "./stats";

/** Distinct readers who must type the same date, and the lead it must have
 * over every answer that contradicts it. Two, so a 2-0 or a 3-1 settles a
 * crop and a 2-1 waits for a third reader. */
export const READERS_TO_AGREE = 2;

/** Answers after which a crop nobody agrees on stops being served and goes to
 * the admin list instead. */
export const DISPUTED_AFTER = 6;

/** People published automatically per Warsaw day. Over it they wait, oldest
 * first, for the next day; an admin's press of „Opublikuj z kolejki” goes past
 * it.
 *
 * What the site ships as `declarationsDailyPublishLimit` in nuxt.config.ts,
 * which the endpoints read (`publishLimitOf`) and
 * NUXT_DECLARATIONS_DAILY_PUBLISH_LIMIT overrides; 0 switches the automatic
 * publication off. A test keeps the two equal. */
export const DAILY_AUTO_PUBLISH_LIMIT = 200;

/** The uid the automatic publication writes under. It contains "pipeline", so
 * `isAutomatedUid` keeps it out of the contributors' stats and the activity
 * feed, the way the import's own approvals are. */
export const DECLARATION_ACTOR = "pipeline-declarations";

/** Request limits of the ingest. The largest crop measured on 2026-10-29 is
 * 78 kB, so 200 kB is a mangled file, not a big one; 25 crops of that size are
 * well inside Cloud Run's 32 MiB and a Firestore commit's 10 MiB. */
export const MAX_EXTRACTS_PER_REQUEST = 25;
export const MAX_CANDIDACIES_PER_REQUEST = 500;
export const MAX_IMAGE_BYTES = 200_000;
export const MAX_REQUEST_IMAGE_BYTES = 8_000_000;

// ---------------------------------------------------------------------------
// The upload
// ---------------------------------------------------------------------------

/** What the crawler concluded for a candidacy: the job's own words
 * (`jobs/bip_crawler/people.py`). */
export const candidacyStatuses = [
  "pending",
  "found",
  "unconfirmed",
  "not_found",
] as const;
export type CandidacyStatus = (typeof candidacyStatuses)[number];

export const unitLevels = ["gmina", "powiat", "wojewodztwo"] as const;
export type UnitLevel = (typeof unitLevels)[number];

/** Offices a local candidacy can be for, in the site's words
 * (`ElectionPosition`). */
export const localOffices = [
  "Rada gminy",
  "Rada miasta",
  "Rada powiatu",
  "Sejmik",
  "Rada dzielnicy",
  "Wójt",
  "Burmistrz",
  "Prezydent",
] as const;
export type LocalOffice = (typeof localOffices)[number];

const reasonCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,40}$/, "a lower_snake_case reason code");

const httpUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\//i, "an http(s) URL");

/** A birth date as the BIP side read it: a day, or a year where the form gives
 * no more. Never the register's. */
const readDate = z
  .string()
  .refine((value) => readingKind(value) !== null, "YYYY-MM-DD or YYYY");

export const declarationCandidacySchema = z.object({
  /** BipPersonOfInterest.key: the won candidacy, stable across rebuilds. */
  key: z.string().regex(/^[0-9a-f]{16}$/),
  /** koryta_ids: the site pages the candidacy was matched to. */
  kids: z.array(z.string().min(1).max(64)).min(1).max(5),
  /** PKW's six digits: WWPPGG a gmina (or a Warsaw dzielnica), WWPP00 a
   * powiat, WW0000 a województwo. */
  teryt: z.string().regex(/^\d{6}$/),
  /** The unit's name, e.g. "Strzelin (gmina miejsko-wiejska)". The site has
   * no TERC names of its own for most gminas, so it shows this. */
  unitName: z.string().min(1).max(200).optional(),
  level: z.enum(unitLevels),
  office: z.enum(localOffices),
  year: z.number().int().min(1990).max(2100),
  status: z.enum(candidacyStatuses),
  reason: reasonCode.nullable().optional(),
  /** Where the search started: the unit's BIP or its office website. */
  bipUrls: z.array(httpUrl).max(10).optional(),
  /** Files that came down for it. */
  files: z.number().int().min(0).max(1000).optional(),
});
export type DeclarationCandidacyInput = z.infer<
  typeof declarationCandidacySchema
>;

const confidence = z.enum(["high", "medium", "low"]).nullable().optional();

export const machineReadingSchema = z.object({
  birthDate: readDate.nullable().optional(),
  confidence,
  method: z.enum(["text_layer", "ocr", "handwriting"]).nullable().optional(),
  inPkwWindow: z.enum(["yes", "no", "none"]).optional(),
  name: z.string().max(200).nullable().optional(),
  nameConfidence: confidence,
  nameMatches: z.boolean().nullable().optional(),
});
export type MachineReading = z.infer<typeof machineReadingSchema>;

/** The date the job's own reading settles, or null when readers must read.
 *
 * A typed date inside the candidacy's exact PKW birth-date window comes as
 * "high" and settles on its own. A date OCR read cleanly inside that window
 * settles too, but only when it is the birth date one of the crop's pages
 * already has (`pageBirthDates`, as the pages store it): readers agreed with
 * all 1,719 such dates they had settled by 2026-11-15, and Szymon asked for
 * them to go to the publication queue on 2026-11-16. Any other OCR date,
 * handwriting and scans go to readers. A year alone is never enough: there
 * is no day to compare with the page's. */
export function machineSettles(
  machine: MachineReading | null | undefined,
  pageBirthDates: readonly unknown[] = [],
): string | null {
  const day = machine?.birthDate;
  if (!day || readingKind(day) !== "date") return null;
  if (machine.confidence === "high") return day;
  const ocrInWindow =
    machine.method === "ocr" &&
    machine.confidence === "medium" &&
    machine.inPkwWindow === "yes";
  const pageHasIt = pageBirthDates.some(
    (born) => typeof born === "string" && born.trim() === day,
  );
  return ocrInWindow && pageHasIt ? day : null;
}

/** A PNG as base64, no bigger than `MAX_IMAGE_BYTES` once decoded. */
export const base64Png = z
  .string()
  .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8);

export const declarationExtractSchema = z
  .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** The page the crop was cut from, 0-based. */
    page: z.number().int().min(0).max(500),
    /** The declaration itself, as BIP serves it. Shown to readers. */
    url: httpUrl,
    /** The BIP page that lists it. */
    pageUrl: httpUrl.nullable().optional(),
    /** The link's label or its table row. */
    label: z.string().max(400).nullable().optional(),
    /** "według stanu na dzień": the year the declaration is for. */
    declarationYear: z.number().int().min(1990).max(2100).nullable().optional(),
    /** Candidacy keys the crop serves, sent in this request or an earlier one.
     * A re-elected person's 2018 and 2024 runs share their files. */
    candidacies: z
      .array(z.string().regex(/^[0-9a-f]{16}$/))
      .min(1)
      .max(20),
    /** Whether the crawler's own link named the person (its label, row,
     * heading or page title), rather than the person being found inside a
     * council-wide file that names nobody. */
    linkNamed: z.boolean().optional(),
    /** `crop`: a picture for readers. `read`: the job read a typed date
     * inside the candidacy's exact PKW window, which settles it without
     * readers; a picture is optional. `failed`: nothing
     * to read. */
    outcome: z.enum(["crop", "read", "failed"]),
    /** Why nothing could be cut, when the outcome is `failed`. */
    reason: reasonCode.nullable().optional(),
    machine: machineReadingSchema.optional(),
    images: z
      .object({ date: base64Png, name: base64Png.nullable().optional() })
      .optional(),
  })
  .refine((extract) => extract.outcome !== "crop" || !!extract.images, {
    message: "a crop needs its images",
    path: ["images"],
  })
  .refine(
    (extract) => extract.outcome !== "read" || machineSettles(extract.machine),
    {
      message: "a read needs a high-confidence full date",
      path: ["machine"],
    },
  );
export type DeclarationExtractInput = z.infer<typeof declarationExtractSchema>;

export const declarationIngestSchema = z.object({
  /** The cutter's version, like ExtractionFact.tag: what made this batch, so
   * a bad one can be found and re-run. */
  tag: z.string().min(1).max(80),
  /** The job run that sent it, for a link to /admin/procesy. */
  runId: z.string().min(1).max(80).optional(),
  candidacies: z
    .array(declarationCandidacySchema)
    .max(MAX_CANDIDACIES_PER_REQUEST)
    .default([]),
  extracts: z
    .array(declarationExtractSchema)
    .max(MAX_EXTRACTS_PER_REQUEST)
    .default([]),
});
export type DeclarationIngest = z.infer<typeof declarationIngestSchema>;

/** The extract's id: one per crop, so the same picture is read once however
 * many candidacies it serves. */
export function extractId(sha256: string, page: number): string {
  return `${sha256}-p${page}`;
}

export const EXTRACT_ID_PATTERN = /^[0-9a-f]{64}-p\d{1,3}$/;

/** Why an item of an upload was not stored.
 *
 * `unconfirmed_name` guards the readers from strangers: a council-wide file
 * that names nobody holds every councillor's declaration, one after another,
 * so a page of it reaches a reader only when the name the job read on that
 * page is the candidate's (`machine.nameMatches`), unless a link named them. */
export type IngestSkipReason =
  | "unknown_candidacy"
  | "no_site_person"
  | "unconfirmed_name"
  | "bad_image"
  | "no_images";

export type DeclarationIngestResult = {
  status: "ok";
  candidacies: {
    created: number;
    updated: number;
    skipped: { key: string; reason: IngestSkipReason }[];
  };
  extracts: {
    created: number;
    updated: number;
    /** Updated, but its images were kept: somebody already answered them. */
    kept: number;
    skipped: { id: string; reason: IngestSkipReason }[];
  };
};

/** Whether the bytes are a PNG, by the signature every PNG starts with. The
 * content type is never taken from the sender. */
export function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return (
    bytes.length > signature.length &&
    signature.every((byte, i) => bytes[i] === byte)
  );
}

/** A PNG's width and height, from its IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// ---------------------------------------------------------------------------
// Reading a crop
// ---------------------------------------------------------------------------

/** What a reader can answer about a crop. `skip` says nothing about the crop
 * and only keeps it from being served to the same reader again. */
export const answerVerdicts = ["date", "unreadable", "empty", "skip"] as const;
export type AnswerVerdict = (typeof answerVerdicts)[number];

/** The longest name a reader can send with an answer, as they read it off
 * the paper: what the answer endpoint takes, and so what the field on
 * /oswiadczenia holds. A longer one would be turned down whole, the date
 * typed beside it with it. */
export const READ_NAME_MAX_LENGTH = 200;

/** Whether readers are asked for the name on the declaration as well as the
 * date. Off for now: /oswiadczenia shows the date line alone, and the server
 * sends no
 * name crop to anybody who would not be shown it. What reads names stays
 * (`agreedName`, `nameFitsPage`, the card's name field), for the day it is
 * switched back on. */
export const READ_NAMES: boolean = false;

/** Where a crop is in its reading. */
export const extractStatuses = [
  "open",
  "agreed",
  "unreadable",
  "disputed",
  "failed",
  "withdrawn",
] as const;
export type ExtractStatus = (typeof extractStatuses)[number];

/** A crop that wants no more readers: its date agreed, its line found
 * unreadable, or its readers at odds, which an admin takes up. With the open
 * crops these are all a reader can ever read: a crop the cutter failed on
 * never reached them, and a withdrawn one is gone. */
export const settledStatuses = [
  "agreed",
  "unreadable",
  "disputed",
] as const satisfies readonly ExtractStatus[];

/** A full date or a year: which one a reading is, or null for neither. */
export function readingKind(value: string): "date" | "year" | null {
  if (/^\d{4}$/.test(value)) return "year";
  return isoDay(value) ? "date" : null;
}

const MONTH_WORDS: Record<string, number> = {
  stycz: 1,
  luty: 2,
  lut: 2,
  marz: 3,
  mar: 3,
  kwie: 4,
  maj: 5,
  czerw: 6,
  lip: 7,
  sierp: 8,
  wrze: 9,
  pazdz: 10,
  listop: 11,
  grud: 12,
};

const ROMAN_MONTHS = [
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "xi",
  "xii",
];

function monthOf(word: string): number | null {
  const folded = normalizePersonName(word).replace(/\s+/g, "");
  if (/^\d{1,2}$/.test(folded)) {
    const month = Number(folded);
    return month >= 1 && month <= 12 ? month : null;
  }
  const roman = ROMAN_MONTHS.indexOf(folded);
  if (roman >= 0) return roman + 1;
  for (const [stem, month] of Object.entries(MONTH_WORDS)) {
    if (folded.startsWith(stem)) return month;
  }
  return null;
}

/** What a reader typed, as a reading: `15.07.1979`, `15 07 1979`,
 * `15-07-1979`, `1979-07-15`, `15 lipca 1979`, `15 VII 1979` and `15.VII.1979`
 * are one day; `1979` alone is a year. A two-digit year is refused rather than
 * guessed at: "79" could be 1979 or a slip.
 *
 * The bounds are what a person on a 2018-2024 council could have been born on,
 * loosely: not before 1900 and not after the day it is read.
 */
export function parseTypedDate(
  text: string,
  today: Date = new Date(),
):
  | { kind: "date" | "year"; value: string }
  | { kind: "invalid"; reason: "empty" | "format" | "range" } {
  const raw = text.trim().toLowerCase();
  if (!raw) return { kind: "invalid", reason: "empty" };

  let y: number;
  let m: number | null = null;
  let d: number | null = null;

  const iso = /^(\d{4})[-./ ](\d{1,2})[-./ ](\d{1,2})$/.exec(raw);
  const parts = raw.split(/[\s./-]+/).filter(Boolean);
  if (/^\d{4}$/.test(raw)) {
    y = Number(raw);
  } else if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (parts.length === 3 && /^\d{4}$/.test(parts[2]!)) {
    d = /^\d{1,2}$/.test(parts[0]!) ? Number(parts[0]) : null;
    m = monthOf(parts[1]!);
    y = Number(parts[2]);
    if (d === null || m === null) return { kind: "invalid", reason: "format" };
  } else if (/^\d{8}$/.test(raw)) {
    // 15071979, the way a hurried reader types it.
    [d, m, y] = [
      Number(raw.slice(0, 2)),
      Number(raw.slice(2, 4)),
      Number(raw.slice(4)),
    ];
  } else {
    return { kind: "invalid", reason: "format" };
  }

  const thisYear = today.getUTCFullYear();
  if (y < 1900 || y > thisYear) return { kind: "invalid", reason: "range" };
  if (m === null || d === null) return { kind: "year", value: String(y) };

  const value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!isoDay(value)) return { kind: "invalid", reason: "format" };
  if (value > today.toISOString().slice(0, 10)) {
    return { kind: "invalid", reason: "range" };
  }
  return { kind: "date", value };
}

/** One reader's answer, as the settling rule needs it. */
export type ReaderAnswer = {
  uid: string;
  verdict: AnswerVerdict;
  /** `YYYY-MM-DD` or `YYYY` when the verdict is `date`. */
  value?: string | null;
  name?: string | null;
  /** False for an answer that has no say in the agreement: one given without
   * an account, or by an account without a confirmed address. It still counts
   * as the reader's own work. Every answer the site stores says which it is,
   * and the server reads a crop's answers that vote by it; an answer that
   * leaves it out, as one put together for this rule alone may, votes. */
  votes?: boolean;
};

export type Settlement =
  | { status: "open" }
  | { status: "agreed"; value: string; kind: "date" | "year"; readers: number }
  | { status: "unreadable"; readers: number }
  | { status: "disputed" };

/** Whether two readings can both be right: the same day, or a year and a day
 * in it. */
function compatible(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

/** Whether an answer has a say in what a crop settles: a person's, and not
 * one stored without a vote. */
export function answerVotes(
  answer: Pick<ReaderAnswer, "uid" | "votes">,
): boolean {
  return !isAutomatedUid(answer.uid) && answer.votes !== false;
}

/**
 * What the answers given so far settle.
 *
 * One reader, one voice: answers are counted by person, never summed, and
 * automated uids are not readers. Nor is an answer that does not vote
 * (`votes: false`), given without an account or by one whose address nobody
 * confirmed: either costs nothing to make, so two of them must not publish a
 * page. An account that votes can claim the answers
 * it gave before it signed in.
 *
 * A date is agreed when at least `READERS_TO_AGREE` readers typed it and it
 * leads the answers that contradict it - another day, or a year it is not in -
 * by as many: 2-0 and 3-1 settle, 2-1 and 3-2 wait. A year typed alone
 * supports every day in it.
 *
 * "Unreadable", "empty" and a skip contradict nothing - a reader who could not
 * make the date out has not read another one - but they settle the crop as
 * unreadable when one more reader than it takes to agree says so and no day
 * has the support to agree. A skip counts with them since the form offers
 * „Pomiń” alone: a crop nobody can read would otherwise stay in the queue
 * for good.
 *
 * The job's own reading is not a voice here: one that settles the crop at
 * upload (`machineSettles`) never reaches readers, and any other is a guess
 * readers must not be anchored by.
 */
export function settleReading(
  answers: readonly ReaderAnswer[],
  options: {
    agree?: number;
    disputedAfter?: number;
  } = {},
): Settlement {
  const agree = options.agree ?? READERS_TO_AGREE;
  const disputedAfter = options.disputedAfter ?? DISPUTED_AFTER;

  // The last answer of each reader, leaving out robots and answers without a
  // say.
  const byReader = new Map<string, ReaderAnswer>();
  for (const answer of answers) {
    if (!answerVotes(answer)) continue;
    byReader.set(answer.uid, answer);
  }
  const readings = [...byReader.values()]
    .filter((a) => a.verdict === "date" && a.value && readingKind(a.value))
    .map((a) => a.value as string);
  const unreadable = [...byReader.values()].filter(
    (a) =>
      a.verdict === "unreadable" ||
      a.verdict === "empty" ||
      a.verdict === "skip",
  ).length;

  const candidates = [...new Set(readings)].sort(
    // Days before years: a day agreed is the better answer.
    (a, b) =>
      (readingKind(a) === "date" ? 0 : 1) - (readingKind(b) === "date" ? 0 : 1),
  );
  let best: Settlement = { status: "open" };
  let bestSupport = 0;
  for (const candidate of candidates) {
    const kind = readingKind(candidate)!;
    // A day is backed by the same day and by its year typed alone; a year by
    // itself and by every day in it.
    const support = readings.filter((r) =>
      kind === "date"
        ? r === candidate || r === candidate.slice(0, 4)
        : compatible(r, candidate),
    ).length;
    const against = readings.filter((r) => !compatible(r, candidate)).length;
    // A year is only the answer when the days typed in it do not agree with
    // each other; a day that agrees wins first.
    const exact = readings.filter((r) => r === candidate).length;
    if (support >= agree && support - against >= agree && exact >= 1) {
      if (kind === "date" && support > bestSupport) {
        best = { status: "agreed", value: candidate, kind, readers: support };
        bestSupport = support;
      }
      if (kind === "year" && best.status === "open") {
        best = { status: "agreed", value: candidate, kind, readers: support };
      }
    }
  }
  if (best.status === "agreed") return best;

  const strongest = Math.max(
    0,
    ...candidates.map(
      (candidate) => readings.filter((r) => compatible(r, candidate)).length,
    ),
  );
  if (unreadable >= agree + 1 && strongest < agree) {
    return { status: "unreadable", readers: unreadable };
  }
  if (byReader.size >= disputedAfter) return { status: "disputed" };
  return { status: "open" };
}

/** The name readers agree the form gives, or null: the most common spelling
 * once folded, when at least `READERS_TO_AGREE` of them gave it. Only answers
 * that vote count, as in `settleReading`. */
export function agreedName(
  answers: readonly ReaderAnswer[],
  agree: number = READERS_TO_AGREE,
): string | null {
  const byKey = new Map<string, { name: string; uids: Set<string> }>();
  for (const answer of answers) {
    if (!answerVotes(answer) || !answer.name?.trim()) continue;
    const key = normalizePersonName(answer.name);
    if (!key) continue;
    const entry = byKey.get(key) ?? {
      name: answer.name.trim(),
      uids: new Set(),
    };
    entry.uids.add(answer.uid);
    byKey.set(key, entry);
  }
  const best = [...byKey.values()].sort((a, b) => b.uids.size - a.uids.size)[0];
  return best && best.uids.size >= agree ? best.name : null;
}

/** Whether a name read off a declaration can be the page's person: the same
 * first name, and the page's surname among the words the form gives. The form
 * asks for "imiona i nazwisko oraz nazwisko rodowe", so a maiden name or a
 * second given name on it is expected, a different surname is not. */
export function nameFitsPage(readName: string, pageName: string): boolean {
  const read = normalizePersonName(readName).split(" ").filter(Boolean);
  const page = normalizePersonName(pageName).split(" ").filter(Boolean);
  if (read.length === 0 || page.length < 2) return true;
  const surnameParts = page.at(-1)!.split(" ");
  return (
    read[0] === page[0] && surnameParts.every((part) => read.includes(part))
  );
}

// ---------------------------------------------------------------------------
// What the pages are sent
// ---------------------------------------------------------------------------

/** A crop to read, as /oswiadczenia gets it.
 *
 * Nothing about whose it is beyond the unit and office it was filed for, and
 * no date from anywhere, but the link to the whole form, which names the
 * person, comes with it. It used to come back with the answer, and was then
 * shown under the next crop, where it read as that crop's (Szymon,
 * 2026-11-01). */
export type DeclarationTask = {
  id: string;
  /** The unit, e.g. "Strzelin (gmina miejsko-wiejska)". */
  unit: string;
  office: LocalOffice | null;
  declarationYear: number | null;
  /** The whole declaration on BIP, and the host it is on. */
  documentUrl: string;
  host: string | null;
  /** data: URLs, because an <img> cannot send the reader's token. */
  images: { date: string; name: string | null };
  imageSize: {
    date: { width: number; height: number };
    name: { width: number; height: number } | null;
  };
};

/** `GET /api/declarations/next?count=N`: the crop to read now, and up to
 * N-1 more after it (N at most 5), so the next one shows without a wait. */
export type DeclarationQueue = {
  task: DeclarationTask | null;
  upcoming: DeclarationTask[];
  /** Crops still waiting for a reader, and what this reader has done. */
  open: number;
  /** Crops that want no more readers (`settledStatuses`): over these and
   * `open`, how far all the readers got. */
  settledCrops: number;
  mine: {
    today: number;
    total: number;
    /** The people this reader found: those they typed a date for that the
     * birth date on the person's page does not contradict, counted as each
     * answer is saved. The tally's „Znaleziono”. */
    found: number;
  };
};

// ---------------------------------------------------------------------------
// How far the declarations got, in people
// ---------------------------------------------------------------------------

/** Why nobody has a readable date of a person yet, as the people snapshot
 * counts them. The first eight are the BIP not letting the crawler through
 * (`jobs/bip_crawler`'s not_found reasons), the next two a search that went
 * through and found no declaration of theirs, the last four a file that came
 * down with no date to read, or nothing tried yet. */
export const peopleSearchReasons = [
  "unreachable",
  "refused",
  "robots",
  "throttled",
  "timeout",
  "download_failed",
  "budget",
  "no_seed",
  "not_listed",
  "no_declarations",
  "no_date_line",
  "unreadable",
  "other_page",
  "pending",
] as const;
export type PeopleSearchReason = (typeof peopleSearchReasons)[number];

/** The stages of the people snapshot, in its order. Each person is in one. */
export const peopleStages = [
  "published",
  "namesakes",
  "mismatched",
  "held",
  "reading",
  "cropped",
  "downloaded",
  "searching",
] as const;
export type PeopleStage = (typeof peopleStages)[number];

const headCount = z.number().int().min(0).max(10_000_000);

/**
 * Where the declarations stand, counted in people (`stats/declaration_people`).
 * The site counts it whole when the night sends what predator knows
 * (`declarationFactsIngestSchema`), and moves the people a daytime event
 * touches (server/utils/declarationPeopleCount.ts, shared/declarationPeople.ts).
 *
 * Who is counted: the draft pages with a won local
 * candidacy and a public post, which a declaration can publish, and the pages
 * a declaration did publish that have one. Every person is in exactly one
 * stage, so the stages add up to `people`.
 */
export const declarationPeopleSchema = z
  .object({
    /** When it was last counted, whole or for the people an event touched. */
    at: z.string().datetime(),
    /** The Warsaw day counted, YYYY-MM-DD. */
    exportDay: z.string().refine((value) => isoDay(value), "YYYY-MM-DD"),
    people: headCount,
    /** Published because a declaration's birth date matched the page's. */
    published: headCount,
    /** A declaration gave another birth date, a day other than a slip of the
     * pen: a namesake, not the councillor. */
    namesakes: headCount,
    /** A declaration gave another birth date that looks like a misreading,
     * a typo or somebody else's file: an admin's to clear up. */
    mismatched: headCount,
    /** The dates match, and the page waits for an admin (`held`). */
    held: headCount,
    /** A crop on the site, waiting for readers. */
    reading: headCount,
    /** A crop cut on predator, not on the site yet. */
    cropped: headCount,
    /** A declaration downloaded, not cut yet. */
    downloaded: headCount,
    /** No date to read yet. */
    searching: headCount,
    searchingBy: z
      .array(
        z.object({ reason: z.enum(peopleSearchReasons), count: headCount }),
      )
      .max(peopleSearchReasons.length),
    /** Namesakes to expect among the people whose date nobody has read yet
     * (reading, cropped, downloaded, searching), from how often a surname
     * that common turned out a namesake so far; null when too few have
     * settled to say. */
    expectedNamesakes: z
      .object({ count: headCount, low: headCount, high: headCount })
      .nullable(),
    /** The settled people by how many Poles carry their surname (PESEL, the
     * same sex's form), and how many in each band turned out namesakes. */
    bySurname: z
      .array(
        z.object({
          min: headCount,
          max: headCount.nullable(),
          settled: headCount,
          namesakes: headCount,
          remaining: headCount,
        }),
      )
      .max(12),
    /** The units holding the most people whose BIP would not let the
     * crawler through. */
    topUnits: z
      .array(
        z.object({
          teryt: z.string().regex(/^\d{6}$/),
          name: z.string().min(1).max(200),
          people: headCount,
          reason: z.enum(peopleSearchReasons),
        }),
      )
      .max(20),
    /** People published a day, counted the same way. */
    publishedByDay: z
      .array(
        z.object({
          day: z.string().refine((value) => isoDay(value), "YYYY-MM-DD"),
          count: headCount,
        }),
      )
      .max(400),
  })
  .refine(
    (snapshot) =>
      snapshot.published +
        snapshot.namesakes +
        snapshot.mismatched +
        snapshot.held +
        snapshot.reading +
        snapshot.cropped +
        snapshot.downloaded +
        snapshot.searching ===
      snapshot.people,
    "the stages must add up to `people`",
  );
export type DeclarationPeople = z.infer<typeof declarationPeopleSchema>;

/** The people snapshot's stages, grouped the way a reader is told them:
 * published, under way (a declaration in hand) and still to find, out of
 * `total`. A namesake is counted apart, outside the total: the declaration
 * showed that the page is not the councillor's, so there is nobody of theirs
 * left to publish. */
export function peopleGroups(snapshot: DeclarationPeople) {
  const underway =
    snapshot.held +
    snapshot.mismatched +
    snapshot.reading +
    snapshot.cropped +
    snapshot.downloaded;
  return {
    published: snapshot.published,
    underway,
    searching: snapshot.searching,
    total: snapshot.people - snapshot.namesakes,
    namesakes: snapshot.namesakes,
  };
}

/** Candidacies one facts body carries at most. */
export const MAX_FACT_CANDIDACIES = 100_000;

/** One candidacy of the night's list, with what predator knows of its files:
 * what the site counts the people snapshot from. No names and no dates: the
 * night reads it from the shared cache. */
export const declarationFactSchema = z.object({
  /** BipPersonOfInterest.key. */
  key: z.string().regex(/^[0-9a-f]{8,64}$/),
  /** koryta_ids: the pages the list matched the candidacy to. */
  kids: z.array(z.string().min(1).max(64)).min(1).max(5),
  teryt: z.string().regex(/^\d{6}$/),
  unitName: z.string().max(200),
  /** The election year. */
  year: z.number().int().min(1990).max(2100),
  /** What the crawl concluded, and its reason as it gives it. */
  status: z.enum(candidacyStatuses),
  reason: z.string().max(40),
  /** A file of theirs this version of the cutter has not cut. */
  uncut: z.boolean(),
  /** A file a link names them in, cut. */
  cutNamed: z.boolean(),
  /** A crop of theirs cut, not on the site yet and not skipped for good. */
  waiting: z.boolean(),
  /** Living Poles with the surname in the person's sex's form (PESEL). */
  bearers: z.number().int().min(0).max(100_000_000),
});
export type DeclarationFact = z.infer<typeof declarationFactSchema>;

/** `POST /api/ingest/declarations/facts`: the night's facts, which the site
 * counts the people snapshot from, whole. */
export const declarationFactsIngestSchema = z.object({
  /** When the night built it. One older than the site's is refused. */
  generation: z.string().datetime(),
  /** When the night's list was built, where known. */
  listAt: z.string().datetime().nullable(),
  /** The predator part the facts came from, and when it was written. */
  part: z.string().max(500),
  partAt: z.string().datetime(),
  /** Count an older generation all the same. */
  force: z.boolean().optional(),
  candidacies: z.array(declarationFactSchema).max(MAX_FACT_CANDIDACIES),
});
export type DeclarationFactsIngest = z.infer<
  typeof declarationFactsIngestSchema
>;

/** What the facts ingest answers: the people counted by stage, and the
 * not_found reasons the site has no word for, counted as `pending`. */
export type DeclarationFactsResult = {
  status: "ok";
  people: number;
  stages: Record<PeopleStage, number>;
  unknownReasons: Record<string, number>;
};

/** `GET /api/declarations/progress`: this reader's part in how far the
 * readers got. */
export type DeclarationProgress = {
  /** Settled crops (`settledStatuses`) with a reading of this reader's that
   * voted. A crop takes two readers at least, so these overlap with other
   * readers' and add up to more than the crops settled. */
  settled: number;
  /** Whether this reader's answers vote now: a reader without one has no part
   * in what settles, and is told what would give them one. */
  votes: boolean;
};

/** `POST /api/declarations/<id>/answer`. */
export type DeclarationAnswer = {
  verdict: AnswerVerdict;
  /** `YYYY-MM-DD` or `YYYY`, as `parseTypedDate` reads the reader's typing. */
  value?: string | null;
  name?: string | null;
};

export type DeclarationAnswerResult = DeclarationQueue & {
  /** Whether this answer settled the crop it answered. */
  settled: boolean;
  /** The crop just answered. */
  answered: { id: string };
};

/** The id a browser files its readings under while nobody is signed in, sent
 * as `X-Reader-Id`: `crypto.randomUUID()`, a version 4 UUID, made once and
 * kept in that browser. */
export const READER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** `POST /api/declarations/claim` with `{ readerId }`: the readings made in
 * this browser without an account, for the account that has just signed in. */
export type DeclarationClaimResult = {
  /** Answers that are the account's now. One to a crop where the account's
   * own answer stands is dropped and not counted, and so is one read off a
   * picture the crop has since been cut again from. */
  claimed: number;
  /** Crops the claimed answers settled. */
  settled: number;
};

/** People the list of a reader's finds shows at most, the newest first. */
export const FOUND_LIST_LIMIT = 100;

/** One person a reader found (`declarationReaderFinds`), as the list a
 * signed-in reader opens from the tally shows them. */
export type DeclarationFind = {
  /** The person's page, followed through merges. */
  id: string;
  name: string;
  /** Whether everybody may see the page (`pageIsPublic`). A draft is listed
   * all the same: any signed-in reader may open one. */
  published: boolean;
  /** The declaration the crop was cut from, as the reading task named it. */
  unit: string;
  office: LocalOffice | null;
  declarationYear: number | null;
};

/** `GET /api/declarations/found`: the people a signed-in reader found, the
 * newest first. A reader without an account is shown only how many. */
export type DeclarationFinds = {
  people: DeclarationFind[];
  /** Everybody the reader found, the tally's „Znaleziono”: more than
   * `people` holds past `FOUND_LIST_LIMIT`, or where a page has gone since. */
  total: number;
};

/** How soon readers should be shown a person page's crops, lowest first - the
 * tier of the `priority` /api/ingest/declarations writes on a crop
 * (`cropPriority`) and /api/declarations/next orders the readers' queue by.
 *
 * The interest is in drafts nobody has verified yet, and among them in the
 * ones a reading could actually publish:
 *
 * - 0: a draft with a birth date and a paid public post. Only a date already
 *   on the page can confirm a settled crop, publish the person and count in
 *   the reader's „Znaleziono”.
 * - 1: the same without a birth date. The reading records one, and the
 *   pipelines' join may propose it for the page.
 * - 2: a draft with no paid public post on it. A reading that settles its date
 *   publishes nobody - the automation holds such a page (`no_public_post`) -
 *   so it goes behind both, though still ahead of a page that is public, since
 *   the draft may yet gain the post the pipelines have not recorded.
 * - 3: a page that is public already, verified by whoever published it. Its
 *   crop is still worth a reading: a settled one is linked on the page.
 *
 * The crawl orders drafts the other way round, as it looks for the dates the
 * pages lack. Only whether a page has a date is read here, never the date;
 * what a crop's own machine reading says of it moves the crop within its
 * tier (`cropPriority`).
 *
 * `hasPublicPost` is `isPublicEmployment` over the page's own employment
 * edges, which only a caller with the graph can answer
 * (`pagesWithAPublicPost` in server/utils/publicPosts.ts).
 */
export function readingPriority(
  page: { published?: unknown; deleted?: unknown; birthDate?: unknown },
  hasPublicPost: boolean,
): 0 | 1 | 2 | 3 {
  if (pageIsPublic(page)) return 3;
  if (!hasPublicPost) return 2;
  return page.birthDate ? 0 : 1;
}

/** The queue's last tier, past every page's (`readingPriority`): a crop
 * whose every page a reading has reached already (`readingReached`).
 * Reading another of their declarations publishes nobody: after a match it
 * repeats the date, and a page read as another day is held whatever the
 * next reading finds (`conflicting_reading`). On 2026-11-17 almost a third
 * of all answers (31%) had gone to such crops. They are still served once
 * nothing else is left, as a second declaration read as another day holds a
 * matched page too. */
export const READ_PRIORITY = 4;

/** How far back within its tier a crop goes when the job's own reading of
 * it is a full date the page's birth date contradicts: readers settled 92%
 * of such crops as another person's date (2026-11-17). Half a tier, so it
 * stays ahead of the next one, and a person's crop that may still be theirs
 * is served before it. */
const CONTRADICTED_BY_PAGE = 0.5;

/** One page a crop is for, as its `priority` depends on it. */
export type QueuePage = {
  /** `readingPriority` of the page. */
  tier: 0 | 1 | 2 | 3;
  /** Whether a reading has reached the page (`readingReached`). */
  read: boolean;
  /** The page's birth date, as the page stores it. */
  birthDate: unknown;
};

/**
 * The `priority` a crop is written with, which /api/declarations/next orders
 * the queue by: the lowest of its pages', each page's being its tier
 * (`readingPriority`), `READ_PRIORITY` once a reading has reached it, and
 * half a tier later where the job read a full date off the crop that is not
 * the page's birth date. A crop with no live page orders as a public one.
 */
export function cropPriority(
  pages: readonly QueuePage[],
  machineDate: unknown,
): number {
  if (pages.length === 0) return 3;
  const machine =
    typeof machineDate === "string" && readingKind(machineDate) === "date"
      ? machineDate
      : null;
  return Math.min(
    ...pages.map((page) => {
      if (page.read) return READ_PRIORITY;
      const born =
        typeof page.birthDate === "string" ? page.birthDate.trim() : "";
      const contradicted = machine !== null && born !== "" && born !== machine;
      return page.tier + (contradicted ? CONTRADICTED_BY_PAGE : 0);
    }),
  );
}

/**
 * Whether a reading has reached the page: one of these crops (any of the
 * page's, as stored) settled on a full date and was compared with the page,
 * whatever the comparison found (`pageOutcomes`): a match, another day, or
 * no date on the page to compare with. A year alone, a crop still read, one
 * readers could not agree on and one an admin took back reach nobody.
 */
export function readingReached(
  crops: readonly {
    status?: unknown;
    agreed?: unknown;
    pageOutcomes?: unknown;
  }[],
  pageId: string,
): boolean {
  return crops.some((crop) => {
    if (crop.status !== "agreed") return false;
    const agreed = crop.agreed as { kind?: unknown } | null | undefined;
    if (agreed?.kind !== "date") return false;
    const outcomes = crop.pageOutcomes;
    return (
      !!outcomes &&
      typeof outcomes === "object" &&
      typeof (outcomes as Record<string, unknown>)[pageId] === "string"
    );
  });
}

/** Why a page whose date matches was not published automatically. Each is
 * somebody's decision the automation must not overrule, or a doubt it cannot
 * settle itself.
 *
 * `admin_decision` holds a draft whose date matches only a date an admin
 * settled on /admin/oswiadczenia (`agreed.by` "admin"). The admin chose it
 * with the pages' dates a click away, so the automation does not publish on
 * it, and the draft waits for somebody to publish it by hand; once public,
 * the page shows the declaration (decision on 2026-11-18). A public page born that day is
 * given no record: it has nothing to wait for, and the admin's date links
 * nothing on it.
 *
 * The last five are checked as the page is published rather than when it is
 * queued: `no_revision`, nothing the automation may approve is what the page
 * shows (no revision at all, or the newest one is not the page as it stands);
 * `no_longer_matches`, the page's birth date or the reading changed while the
 * page waited; `candidacy_reviewed`, a reviewer rejected a revision of the
 * candidacy the declaration is for, or a person's own is waiting on it;
 * `revision_rejected`, a reviewer turned down a revision of the page itself;
 * `conflicting_reading`, another settled declaration that names the page was
 * read as another birth date.
 *
 * `no_public_post` is the one reason that is about the person rather than
 * about the reading or anybody's decision: nothing on the page is a paid post
 * at an institution the public sector is known to own, which is what the site
 * exists to record. A declaration is filed by every councillor, so a mandate
 * alone brings a page no closer to being one koryta.pl publishes. The rule is
 * the site's own employment rule, `publicEmployment` in shared/stats.ts, and
 * the post may be a past one. Checked as the page is published, so a job
 * added while the page waited counts. */
export const publicationHoldReasons = [
  "two_pages",
  "admin_decision",
  "needs_split",
  "kept_hidden",
  "pending_proposal",
  "name_differs",
  "no_public_post",
  "no_candidacy_on_page",
  "ambiguous_candidacy",
  "two_places",
  "no_revision",
  "no_longer_matches",
  "candidacy_reviewed",
  "revision_rejected",
  "conflicting_reading",
] as const;
export type PublicationHoldReason = (typeof publicationHoldReasons)[number];

/** The hold that is the rule itself rather than a doubt anybody can settle. */
export const RULED_OUT: PublicationHoldReason = "no_public_post";

/** The daily limit as the runtime config gives it: a whole number, 0 for
 * anything else. An environment override arrives as whatever `destr` made of
 * the string, so it is not trusted to be a number. Here rather than beside
 * the queue, so the endpoints' tests read the config through it for real. */
export function publishLimitOf(config: {
  declarationsDailyPublishLimit?: unknown;
}): number {
  const limit = Number(config.declarationsDailyPublishLimit);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
}

/** The Warsaw hours, from inclusive to exclusive, in which nothing is
 * published from the queue, neither by the automation nor at an admin's
 * press.
 *
 * The nightly people import runs in them, and it reads a page outside a
 * transaction and later writes it back whole with the `published` it read
 * (server/api/ingest/person.post.ts, `createRevisionTransaction` in
 * server/utils/revisions.ts): a page published in between is silently made a
 * draft again. A precondition in the import is the real fix; until then the
 * queue keeps out of its way, and so does the check on the runs the jobs
 * report (`peopleImportRunning`), which also covers the runs asked for during
 * the day and a night that runs late. Here rather than beside the queue, so
 * /admin/oswiadczenia can say the hours. */
export const PEOPLE_IMPORT_WINDOW = { from: 1, to: 7 } as const;

/** People one press of „Opublikuj z kolejki” takes up at most. The snackbar
 * says how many still wait, for the next press.
 *
 * Sized so a press finishes well inside a request: a page costs about 20
 * Firestore round trips one after another, whatever its size (2026-10-30, on
 * the test double: one candidacy and one job 19; 20 for the heaviest of the
 * 6,698 dated drafts in that night's export, 73 jobs, which go up in one
 * commit). At a pessimistic 100 ms a round trip, from App Hosting in
 * europe-west4 to the database in europe-central2, 25 pages are under a
 * minute, a fifth of the 300 s Cloud Run gives a request on both backends. */
export const PRESS_BATCH = 25;

/** Where a page's publication stands, as `declarationPublications` stores
 * it. `confirmed` is a page that was public already when its date matched:
 * nothing to publish, but the declaration is linked on it. `publishing` is a
 * page a pass has taken up - the automation under a slot of the day, an
 * admin's press without one - and whose writes are under way, or were cut
 * short; one left there for long is tried again.
 *
 * A held page an admin said will not be published stays `held`, with
 * `declinedAt` on the record (`declinePublication`): a release that knows
 * nothing of it then keeps it held too, where a status of its own would be
 * queued again by the first reading it meets. */
export const publicationStatuses = [
  "queued",
  "publishing",
  "published",
  "held",
  "confirmed",
] as const;
export type PublicationStatus = (typeof publicationStatuses)[number];

/** What a settled reading said about one page it is for. `held` is a match the
 * automation will not act on (two pages with the same date, or a date an admin
 * settled, which holds a draft and leaves a public page without a record),
 * `queued` a draft waiting for its slot, `confirmed` a page that was public
 * already. */
export const pageOutcomes = [
  "no_date",
  "different",
  "confirmed",
  "queued",
  "held",
] as const;
export type PageOutcome = (typeof pageOutcomes)[number];

/** What a settled reading said about its pages, summed up on the crop: `same`
 * when any page has the date, else `different` when any has another one. */
export type PageMatch = "same" | "different" | "no_date";

/** Why a relation of an automatically published page stayed off the site: its
 * company is a draft, or it fails the rule the people import uses for jobs it
 * puts live without a reviewer (`waitingEdgeRefusal` in
 * server/utils/edgePublication.ts), or - `date_not_from_entry` - the page's
 * birth date did not come with the register entry the jobs are listed under,
 * so the date the declaration confirms says nothing about whose jobs they are.
 *
 * A candidacy is listed only by a pass that finishes one cut short after the
 * page went up, for what came in between: a reviewer's rejection
 * (`rejected`), a person's version waiting (`by_hand`), or a run elsewhere in
 * the same election (`two_places`). Before the page is up, each of those holds
 * the whole page. `needs_split` is every relation of a page marked as two
 * people after it went up. */
export type PublicationEdgeHold =
  | "company_draft"
  | "approved_hidden"
  | "rejected"
  | "by_hand"
  | "not_held"
  | "date_not_from_entry"
  | "two_places"
  | "needs_split";

/** What one pass over the queue did: the automation's, or an admin's press
 * of „Opublikuj z kolejki”. `skipped` says why it took up no new page: `off`
 * while the daily limit is 0 (never at a press, which goes past the limit),
 * `night` inside the people import's window, `import` while a people import
 * is running, or while whether one is cannot be told. At a limit of 0 a pass
 * still finishes the relations of a page an earlier pass put up and did not
 * finish. */
export type DrainResult = {
  day: string;
  limit: number;
  skipped: "off" | "night" | "import" | null;
  published: string[];
  held: { personId: string; reason: PublicationHoldReason }[];
  /** Queued pages somebody else made public in the meantime. */
  confirmed: string[];
  /** Pages whose writes failed: left `publishing`, to be tried again. */
  failed: string[];
  /** Whether it stopped because the day's limit was reached. Never at a
   * press. */
  capReached: boolean;
  /** The pages still waiting in the queue after a press, as the overview
   * counts them; null after the automation's own passes, which do not count
   * them. */
  waiting: number | null;
};

/** What `POST /api/declarations/sweep` did: the settled crops it compared with
 * their pages again, the pages it found taken off the site by a stale write
 * and put back up (or held, with their relations taken down), and the pass
 * over the queue after it. */
export type SweepResult = {
  checked: number;
  /** Crops whose comparison came out differently this time. */
  changed: number;
  reverted: {
    restored: string[];
    held: { personId: string; reason: PublicationHoldReason }[];
  };
  drain: DrainResult;
};

/** What an admin's „Sprawdź ponownie” on a held page did: it went up, it was
 * public already, something still holds it (the reason may be a new one), or
 * it was not looked at, for the reasons no pass runs (`DrainResult.skipped`). */
export type RecheckResult =
  | { outcome: "published" }
  | { outcome: "confirmed" }
  | { outcome: "held"; reason: PublicationHoldReason }
  | { outcome: "skipped"; skipped: "night" | "import" };

/** Who settled a crop's date (`agreed.by`): readers who agreed on it blind,
 * the job at upload (`machineSettles`: off a typed form, or by OCR when the
 * date is already the page's; `machine.method` says which), or an admin on
 * /admin/oswiadczenia. */
export const settledBy = ["readers", "machine", "admin"] as const;
export type SettledBy = (typeof settledBy)[number];

/** A crop on an admin list: what readers typed, and the pages it is for. */
export type DeclarationReviewRow = {
  id: string;
  unit: string;
  office: LocalOffice | null;
  declarationYear: number | null;
  documentUrl: string;
  status: ExtractStatus;
  /** Readers' readings, most first. Admins only: readers never see these. */
  readings: { value: string; readers: number }[];
  unreadable: number;
  agreed: string | null;
  /** Who settled `agreed`; null while nothing is settled. */
  agreedBy: SettledBy | null;
  machine: {
    birthDate: string | null;
    confidence: string | null;
    /** How the job read it: `text_layer`, `ocr` or `handwriting`. */
    method?: string | null;
  } | null;
  /** The pages, with the date each stores: admins compare them. */
  people: {
    id: string;
    name: string;
    published: boolean;
    birthDate: string | null;
  }[];
  updatedAt: string;
};

/** A crop that gives a held page another date, as its row lists it: whether
 * an admin can still decide it here, or it was settled already, as another
 * page's declaration with that page's date. */
export type HeldCropRow = DeclarationReviewRow & { decidable: boolean };

/** A person published from the queue, waiting in it, held or declined: by the
 * automation, at an admin's press of „Opublikuj z kolejki”, or by hand while
 * held. `declined` is a held record with `declinedAt`. */
export type DeclarationPublicationRow = {
  personId: string;
  name: string;
  status: "queued" | "published" | "held" | "declined";
  /** What the page was held for when it was last looked at, which can be out
   * of date: read `paidPost` for the one thing that decides what becomes of
   * it. */
  reason: PublicationHoldReason | null;
  /** Whether the page is public now. A held one can be: published by hand
   * while it waited, or public already when a second page held it. */
  pagePublic: boolean;
  /** Of a held page: whether somebody is paid for a public post on it now,
   * read off the page rather than the record (`pagesWithAPublicPost`). */
  paidPost?: boolean;
  at: string;
  unit: string;
  documentUrl: string;
  /** Relations that went live with the page, and those held back. */
  edges: { published: number; held: number };
  /** Whether an admin's press took the page up last, rather than the
   * automation on its own. */
  pressed: boolean;
  /** Whether an admin published the page by hand while it was held
   * (`closeHoldOnPublication`). */
  byHand?: boolean;
};

/**
 * Whether a person is one the site will not publish, and so not on the list of
 * what waits for an admin: an admin said so, or the page has no paid public
 * post, which is what the automation publishes nobody without.
 *
 * Asked of the page as it is now, and whatever the page was held for. A hold
 * records the first reason that applied when it was last looked at, and the
 * reasons are asked in an order, so a stored reason says nothing about the
 * ones after it: 21 of the 142 pages held for something else on 2026-11-06 had
 * no such post either, and resolving their candidacies would have been work on
 * people nobody publishes. It also lets a page come back by itself the day it
 * gains a post, where a stored reason would keep it out for good.
 *
 * A page that is public is neither: its row has a hold left to close.
 */
export function publicationSetAside(
  row: Pick<DeclarationPublicationRow, "status" | "pagePublic" | "paidPost">,
): boolean {
  return (
    row.status === "declined" ||
    (row.status === "held" && !row.pagePublic && row.paidPost === false)
  );
}

/** Everything /admin/oswiadczenia shows, counted when asked. */
export type DeclarationOverview = {
  at: string;
  /** People published automatically a day; 0 means switched off. */
  dailyLimit: number;
  candidacies: {
    total: number;
    /** Distinct pages the candidacies are for. */
    people: number;
    byStatus: Record<CandidacyStatus, number>;
    notFound: { reason: string; count: number }[];
  };
  extracts: {
    total: number;
    byStatus: Record<ExtractStatus, number>;
    failed: { reason: string; count: number }[];
  };
  readers: {
    answers: number;
    readers: number;
    /** The last 30 Warsaw days, oldest first. */
    days: { day: string; answers: number; settled: number }[];
  };
  /** What settled readings said about the pages they are for. */
  pages: {
    same: number;
    different: number;
    noDate: number;
    /** Same date, page already public. */
    confirmed: number;
  };
  publications: {
    queued: number;
    published: number;
    /** Held and waiting for an admin: `lists.held`. */
    held: number;
    /** Who will not be published (`publicationSetAside`). */
    setAside: number;
    /** Published by the automation today (Warsaw), against `dailyLimit`. An
     * admin's press takes no place of it, so its pages are not counted. */
    today: number;
    /** `held` by reason. */
    heldBy: { reason: PublicationHoldReason; count: number }[];
  };
  lists: {
    disputed: DeclarationReviewRow[];
    different: DeclarationReviewRow[];
    held: DeclarationPublicationRow[];
    setAside: DeclarationPublicationRow[];
    recent: DeclarationPublicationRow[];
  };
  /** Uploads, newest first. */
  runs: { tag: string; runId: string | null; extracts: number; at: string }[];
};

/** What a published person's page says about their declarations: those whose
 * reading still confirms the page's birth date. A 404, never an empty answer,
 * for a page that is not public: an empty 200 would be cached for hours and
 * outlive the publication. */
export type PersonDeclarations = {
  /** Set when the site published the page itself. */
  autoPublished: { at: string } | null;
  declarations: {
    url: string;
    year: number | null;
    unit: string;
    office: LocalOffice | null;
  }[];
};

/** One of a page's crops, as a signed-in reader sees it on the page while it
 * is a draft. */
export type PersonDeclarationCrop = {
  id: string;
  /** Never `withdrawn`: a crop an admin took back is nobody's. */
  status: ExtractStatus;
  /** Why the cutter cut nothing, of a `failed` one: the job's code
   * (`declarationReasonLabel` names it). */
  failure: string | null;
  unit: string;
  office: LocalOffice | null;
  /** The whole declaration on BIP. */
  documentUrl: string;
  /** Answers that vote, given so far. */
  answers: number;
  /** The settled reading, `YYYY-MM-DD` or `YYYY`, and who settled it. */
  agreed: string | null;
  agreedBy: SettledBy | null;
  /** What the settled reading said about this page, once compared. */
  outcome: PageOutcome | null;
  /** The pictures' own pixels; null for a date the job read off a typed
   * form and sent without one. */
  imageSize: {
    date: { width: number; height: number };
    name: { width: number; height: number } | null;
  } | null;
};

/** Where the publication of a page that is not public stands, as its
 * record says (`declarationPublications`). `declined` is a held record an
 * admin said will not be published. */
export type PersonPublicationState = {
  status: "queued" | "publishing" | "held" | "declined";
  reason: PublicationHoldReason | null;
  /** Of a held page: whether a paid public post is on it now
   * (`pagesWithAPublicPost`), which decides what an admin does with it. */
  paidPost: boolean;
};

/** The first local elections whose winners a page with no crop lists, with
 * the search for each one's declaration (decision on 2026-11-20): the terms
 * the crawler looks for declarations of. */
export const DECLARATION_SEARCH_SINCE = 2014;

/** A local election the person won, and what the crawler found when it
 * looked for their declaration on that unit's BIP: on a draft with no crop,
 * where to look for it by hand. */
export type PersonDeclarationSearch = {
  year: number;
  office: LocalOffice;
  /** The gmina as the crawler names it, or the region the page files the
   * candidacy under where the crawler never looked. */
  unit: string;
  /** The crawler's verdict, or null where it never looked. */
  status: CandidacyStatus | null;
  /** The crawler's code for it (`declarationReasonLabel` names it). */
  reason: string | null;
  /** Files that came down for it. */
  files: number;
  /** Where its search started: the unit's BIP, or its office's website. */
  bipUrl: string | null;
};

/** A link to a person's declaration somebody found by hand and gave on the
 * page (`declarationLinks`), for the crawl to fetch. Who gave it stays on the
 * server: the page says only whether it was this reader. */
export type PersonDeclarationLink = {
  url: string;
  /** When it was given, ISO. */
  at: string;
  mine: boolean;
};

/** The longest link the page takes, as the ingest takes a declaration's. */
export const MAX_DECLARATION_LINK_LENGTH = 2000;

/** `POST /api/nodes/<id>/declaration-links`. */
export const declarationLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .max(MAX_DECLARATION_LINK_LENGTH)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.hostname.includes(".")
        );
      } catch {
        return false;
      }
    }, "an http(s) address"),
});

/** `GET /api/nodes/<id>/declaration-crops`: the crops of a draft's
 * declarations and where its publication stands, for a signed-in reader of
 * the page before it is public (decision on 2026-11-20), and with no crop,
 * the elections it won, the searches for their declarations and the links
 * readers gave. */
export type PersonDeclarationCrops = {
  publication: PersonPublicationState | null;
  /** The ones that tell most first (`cropOrder`). */
  crops: PersonDeclarationCrop[];
  /** Only where there is no crop: the newest first. */
  searches: PersonDeclarationSearch[];
  /** Only where there is no crop: the oldest first. */
  links: PersonDeclarationLink[];
};

/** How much a crop says about its page, for the order it is shown in: a
 * date that matches the page first, then a date that contradicts it -
 * likely a namesake's declaration, or a date wrong on one side, and either
 * way more than a reading still to come - then one readers left to an admin,
 * then what still waits for readers (the most answered first), then a
 * reading compared with nothing, then the unreadable, and last a declaration
 * nothing could be cut from. */
export function cropOrder(crop: PersonDeclarationCrop): number {
  if (crop.status === "agreed") {
    if (
      crop.outcome === "queued" ||
      crop.outcome === "held" ||
      crop.outcome === "confirmed"
    ) {
      return 0;
    }
    if (crop.outcome === "different") return 1;
    return 4;
  }
  if (crop.status === "disputed") return 2;
  if (crop.status === "open") return 3;
  if (crop.status === "failed") return 6;
  return 5;
}
