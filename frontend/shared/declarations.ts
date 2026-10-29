/**
 * Birth dates read off BIP asset declarations (oświadczenia majątkowe).
 *
 * A job on predator finds the declarations of people the site has a page for,
 * cuts the handwritten "urodzony(a) ..." line out of each one and uploads the
 * crop through `/api/ingest/declarations`. Signed-in readers type what the
 * crop says on /oswiadczenia; once enough of them agree, the site compares the
 * reading with the birth date the page already stores, and a draft whose date
 * matches is published automatically, a few a day.
 *
 * The declaration is evidence against the register, so nothing on the BIP
 * side ever carries a date the site already knows: not the upload, not the
 * reading task. The two meet only here, after the reading is settled
 * (Szymon, 2026-10-29). Readers read blind.
 */
import { z } from "zod";
import { isoDay } from "./dates";
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
 * first, for the next day. */
export const DAILY_AUTO_PUBLISH_LIMIT = 10;

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
 * Only a typed date inside the candidacy's exact PKW birth-date window comes
 * as "high" (Szymon, 2026-10-29: such a date settles without readers;
 * handwriting and scans go to them). A year alone is never enough: there is
 * no day to compare with the page's. */
export function machineSettles(
  machine: MachineReading | null | undefined,
): string | null {
  if (machine?.confidence !== "high" || !machine.birthDate) return null;
  return readingKind(machine.birthDate) === "date" ? machine.birthDate : null;
}

const base64Png = z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8);

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
     * readers (Szymon, 2026-10-29); a picture is optional. `failed`: nothing
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

/**
 * What the answers given so far settle.
 *
 * One reader, one voice: answers are counted by person, never summed, and
 * automated uids are not readers. A date is agreed when at least
 * `READERS_TO_AGREE` readers typed it and it leads the answers that contradict
 * it - another day, or a year it is not in - by as many: 2-0 and 3-1 settle,
 * 2-1 and 3-2 wait. A year typed alone supports every day in it.
 *
 * "Unreadable" and "empty" contradict nothing - a reader who could not make the
 * date out has not read another one - but they settle the crop as unreadable
 * when one more reader than it takes to agree says so and no day has the
 * support to agree.
 *
 * The job's own reading is not a voice here: a high-confidence one settles
 * the crop at upload (`machineSettles`) and never reaches readers, and any
 * other is a guess readers must not be anchored by.
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

  // The last answer of each reader, robots left out.
  const byReader = new Map<string, ReaderAnswer>();
  for (const answer of answers) {
    if (isAutomatedUid(answer.uid) || answer.verdict === "skip") continue;
    byReader.set(answer.uid, answer);
  }
  const readings = [...byReader.values()]
    .filter((a) => a.verdict === "date" && a.value && readingKind(a.value))
    .map((a) => a.value as string);
  const unreadable = [...byReader.values()].filter(
    (a) => a.verdict === "unreadable" || a.verdict === "empty",
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
 * once folded, when at least `READERS_TO_AGREE` of them gave it. */
export function agreedName(
  answers: readonly ReaderAnswer[],
  agree: number = READERS_TO_AGREE,
): string | null {
  const byKey = new Map<string, { name: string; uids: Set<string> }>();
  for (const answer of answers) {
    if (isAutomatedUid(answer.uid) || !answer.name?.trim()) continue;
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
 * Read blind: nothing about whose it is beyond the unit and office it was
 * filed for, no date from anywhere, and not even the link to the whole form,
 * which names the person - a reader who looked them up on the site could copy
 * the page's date instead of reading the crop, and that is exactly the
 * agreement that publishes. The link comes back with the answer. */
export type DeclarationTask = {
  id: string;
  /** The unit, e.g. "Strzelin (gmina miejsko-wiejska)". */
  unit: string;
  office: LocalOffice | null;
  declarationYear: number | null;
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
  mine: { today: number; total: number };
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
  /** The crop just answered, now that it was read blind: the whole form on
   * BIP, for a reader who wants to see it. */
  answered: { id: string; documentUrl: string; host: string | null };
};

/** Why a page whose date matches was not published automatically. Each is
 * somebody's decision the automation must not overrule, or a doubt it cannot
 * settle itself. */
export const publicationHoldReasons = [
  "two_pages",
  "needs_split",
  "kept_hidden",
  "pending_proposal",
  "name_differs",
  "no_candidacy_on_page",
  "ambiguous_candidacy",
  "two_places",
] as const;
export type PublicationHoldReason = (typeof publicationHoldReasons)[number];

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
  machine: { birthDate: string | null; confidence: string | null } | null;
  /** The pages, with the date each stores: admins compare them. */
  people: {
    id: string;
    name: string;
    published: boolean;
    birthDate: string | null;
  }[];
  updatedAt: string;
};

/** A person the automation published, queued or held. */
export type DeclarationPublicationRow = {
  personId: string;
  name: string;
  status: "queued" | "published" | "held";
  reason: PublicationHoldReason | null;
  at: string;
  unit: string;
  documentUrl: string;
  /** Relations that went live with the page, and those held back. */
  edges: { published: number; held: number };
};

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
    held: number;
    /** Published today (Warsaw), against `dailyLimit`. */
    today: number;
    heldBy: { reason: PublicationHoldReason; count: number }[];
  };
  lists: {
    disputed: DeclarationReviewRow[];
    different: DeclarationReviewRow[];
    held: DeclarationPublicationRow[];
    recent: DeclarationPublicationRow[];
  };
  /** Uploads, newest first. */
  runs: { tag: string; runId: string | null; extracts: number; at: string }[];
};

/** What a published person's page says about their declarations. A 404, never
 * an empty answer, for a page that is not public: an empty 200 would be cached
 * for hours and outlive the publication. */
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
