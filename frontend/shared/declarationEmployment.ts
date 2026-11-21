/**
 * Posts read off BIP asset declarations: the employer line under the birth
 * date (slice 1), and later sections VII and VIII.
 *
 * The pipeline cuts each declaration's header and bands and sends them, with
 * its suggestions for printed bands (`employmentIngestSchema`). Readers say
 * which institution and role each line names (`employmentAnswerSchema`), and
 * `settleEmployment` decides what their answers agree on. Nothing here reads
 * or writes Firestore: the server keeps a band's reading state as a map on the
 * declaration's date page (`EmploymentState`, in `EMPLOYMENT_FIELDS`), and
 * what agreed readings say goes on `employed` edges.
 *
 * The role chips, their families and the patterns free-text names fold by are
 * in declarationEmploymentRoles.json, which the pipeline reads too.
 */
import { z } from "zod";
import rolesFile from "./declarationEmploymentRoles.json";
import {
  answerVotes,
  base64Png,
  DISPUTED_AFTER,
  EXTRACT_ID_PATTERN,
  MAX_EXTRACTS_PER_REQUEST,
  READERS_TO_AGREE,
  readingKind,
  RULED_OUT,
  settleReading,
  type LocalOffice,
} from "./declarations";
import { isValidRegon, normalizeRegon } from "./identifiers";
import { pageIsPublic } from "./model";
import { normalizePersonName } from "./names";

/** Whether a declared income reaches any page or any route. Off until the
 * pay decision is made: income is stored, own income only, and shown
 * nowhere. */
export const DECLARED_INCOME_SHOWN: boolean = false;

/** Suggestions the machine sends for one printed band at most. */
export const MAX_SUGGESTIONS = 4;
/** Rows one answer holds at most. */
export const MAX_ROWS = 8;
/** Pictures one band is cut into at most: handwriting at 300 dpi comes in
 * strips, each within `MAX_IMAGE_BYTES`. */
export const MAX_STRIPS = 12;
/** Written lines one band holds at most. */
export const MAX_LINES = 40;
/** Picture bytes a band's document holds at most, its header's included: a
 * Firestore document stays under 1 MiB. */
export const MAX_BAND_PICTURE_BYTES = 1_000_000;
/** Suggestions one card shows at most: the machine's and the page's own
 * posts. */
export const MAX_SUGGESTIONS_SHOWN = 12;
/** „Brakuje części” reports that take an item off the queue until its band
 * is cut again, wider. */
export const RECUT_AFTER = 2;

// ---------------------------------------------------------------------------
// Bands and ids
// ---------------------------------------------------------------------------

/** The bands readers read, each a reading of its own. */
export const readingBands = ["employer", "vii", "viii"] as const;
export type ReadingBand = (typeof readingBands)[number];

/** The map a band's reading state is kept in, on its declaration's
 * `declarationExtracts` document. */
export const EMPLOYMENT_FIELDS = {
  employer: "employment",
  vii: "employmentVii",
  viii: "employmentViii",
} as const satisfies Record<ReadingBand, string>;

/** `declarationExtractImages/<item>-<band>`: the band's pictures and its
 * header's. */
export function employmentImagesId(item: string, band: ReadingBand): string {
  return `${item}-${band}`;
}

/** `declarationAnswers/<item>-<band>_<uid>`: one reader's answer to a band.
 * Unlike a date answer it has no `extractId`, so nothing that counts date
 * answers sees it. */
export function employmentAnswerId(
  item: string,
  band: ReadingBand,
  uid: string,
): string {
  return `${item}-${band}_${uid}`;
}

/** The key of one agreed row in an edge's `declared` map. */
export function declaredKey(
  item: string,
  band: ReadingBand,
  row: number,
): string {
  return `${item}:${band}:${row}`;
}

// ---------------------------------------------------------------------------
// Role chips
// ---------------------------------------------------------------------------

/** What a role is, for what becomes of a post: an elected office; an
 * executive post in a local or state government, or on a zarząd; a
 * managerial one; or a staff post. */
export const roleKinds = [
  "elected",
  "executive",
  "managerial",
  "staff",
] as const;
export type RoleKind = (typeof roleKinds)[number];

/** The offices whose holders' titles follow the gmina's office as PKW names
 * it: TERYT cannot tell a burmistrz from a prezydent. */
export const mayorOffices = [
  "Wójt",
  "Burmistrz",
  "Prezydent",
] as const satisfies readonly LocalOffice[];
export type MayorOffice = (typeof mayorOffices)[number];

/** The chip a reader picks when the role is not on the list. */
export const OTHER_ROLE = "inne";

const chipId = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const chipList = z.array(chipId).min(1);

const institutionsSchema = z
  .object({
    urzad_gminy: chipList,
    starostwo: chipList,
    urzad_marszalkowski: chipList,
    urzad_wojewodzki: chipList,
    szkola: chipList,
    jednostka: chipList,
    spolka: chipList,
  })
  .strict();

/** The kinds of institution a card offers its own chips for. */
export type InstitutionKind = keyof z.infer<typeof institutionsSchema>;
export const institutionKinds = institutionsSchema.keyof().options;

const rolesFileSchema = z
  .object({
    about: z.string(),
    prefixes: z.array(z.string()),
    families: z
      .array(
        z.object({
          id: chipId,
          /** One of the register's organs: Zarząd, Rada Nadzorcza, Prokurent
           * or Pełnomocnik. */
          board: z.boolean(),
          patterns: z.array(z.string()).min(1),
        }),
      )
      .min(1),
    roles: z
      .array(
        z.object({
          id: chipId,
          label: z.string().min(1).max(60),
          kind: z.enum(roleKinds).nullable(),
          family: chipId.nullable(),
          office: z.enum(mayorOffices).optional(),
        }),
      )
      .min(1),
    institutions: institutionsSchema,
    seats: chipList,
  })
  .superRefine((file, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const families = new Set(file.families.map((family) => family.id));
    if (families.size !== file.families.length) issue("duplicate family");
    for (const pattern of [
      ...file.prefixes,
      ...file.families.flatMap((family) => family.patterns),
    ]) {
      try {
        new RegExp(pattern);
      } catch {
        issue(`a pattern that does not compile: ${pattern}`);
      }
    }
    const roles = new Set(file.roles.map((role) => role.id));
    if (roles.size !== file.roles.length) issue("duplicate role");
    const kindOf = new Map<string, RoleKind>();
    for (const role of file.roles) {
      if ((role.family === null) !== (role.kind === null)) {
        issue(`${role.id}: a role has a family and a kind, or neither`);
      }
      if (role.family === null || role.kind === null) continue;
      if (!families.has(role.family)) issue(`${role.id}: unknown family`);
      const kind = kindOf.get(role.family) ?? role.kind;
      if (kind !== role.kind) issue(`${role.family}: chips of two kinds`);
      kindOf.set(role.family, kind);
    }
    if (!roles.has(OTHER_ROLE)) issue(`no "${OTHER_ROLE}" chip`);
    for (const id of [
      ...Object.values(file.institutions).flat(),
      ...file.seats,
    ]) {
      if (!roles.has(id)) issue(`unknown role ${id}`);
    }
  });

const ROLES = rolesFileSchema.parse(rolesFile);

/** A role a reader can pick. */
export type RoleChip = {
  /** Never changes: answers and edges keep it. */
  id: string;
  /** What the chip says, and what a post it creates is named. */
  label: string;
  /** Null for „Inne”. */
  kind: RoleKind | null;
  /** What a declared post is matched to the person's posts by; null for
   * „Inne”, whose text is folded instead (`roleFamilyOf`). */
  family: string | null;
  /** For a mayor's chip and their deputy's: the gmina office it is offered
   * for. */
  office?: MayorOffice;
};

export const roleChips: readonly RoleChip[] = ROLES.roles;

const CHIPS: ReadonlyMap<string, RoleChip> = new Map(
  roleChips.map((chip) => [chip.id, chip]),
);

/** The chip with this id, if there is one. */
export function roleChip(id: string): RoleChip | undefined {
  return CHIPS.get(id);
}

/** Every family, in the order free-text names are folded by. */
export const roleFamilies: readonly string[] = ROLES.families.map(
  (family) => family.id,
);

const BOARD_FAMILIES: ReadonlySet<string> = new Set(
  ROLES.families.filter((family) => family.board).map((family) => family.id),
);

/** Whether the family is one of the register's organs, whose seats at a KRS
 * company the register itself records. */
export function isBoardFamily(family: string | null | undefined): boolean {
  return !!family && BOARD_FAMILIES.has(family);
}

const FAMILY_KINDS: ReadonlyMap<string, RoleKind> = new Map(
  roleChips.flatMap((chip) =>
    chip.family && chip.kind ? [[chip.family, chip.kind] as const] : [],
  ),
);

/** The kind every chip of the family has; null for a family no chip is in,
 * which only free-text names fold to. */
export function familyKind(family: string | null | undefined): RoleKind | null {
  return (family && FAMILY_KINDS.get(family)) || null;
}

/** The chips a card offers for a kind of institution, in their order. At an
 * urząd gminy the mayor's chips and their deputy's follow the gmina's office
 * as PKW names it; with no office known, all three are offered. */
export function rolesFor(
  institution: InstitutionKind,
  office?: string | null,
): RoleChip[] {
  const known = mayorOffices.find((name) => name === office) ?? null;
  return ROLES.institutions[institution]
    .map((id) => CHIPS.get(id)!)
    .filter((chip) => !chip.office || !known || chip.office === known);
}

/** The seats a section VII row offers. */
export const seatRoles: readonly RoleChip[] = ROLES.seats.map((id) =>
  CHIPS.get(id)!,
);

const PREFIXES = ROLES.prefixes.map((pattern) => new RegExp(pattern));
const FAMILY_PATTERNS = ROLES.families.map((family) => ({
  id: family.id,
  patterns: family.patterns.map((pattern) => new RegExp(pattern)),
}));

/**
 * The family a free-text role belongs to, or null when it names none: an
 * edge name typed by hand („prezes”, „Zastępca Wójta”), the register's organ
 * („Zarząd”, „Rada Nadzorcza”) or a reader's „Inne”. „p.o.”, „pełniący
 * obowiązki” and an ordinal („I Zastępca”) are cut off first, so an acting
 * director is a director and a first deputy a deputy. A mandate („radny”), a
 * contract, a bare „członek” or a council's komisja rewizyjna names no
 * family.
 */
export function roleFamilyOf(name: string | null | undefined): string | null {
  if (!name) return null;
  let folded = normalizePersonName(name);
  for (const prefix of PREFIXES) folded = folded.replace(prefix, "");
  if (!folded) return null;
  return (
    FAMILY_PATTERNS.find((family) =>
      family.patterns.some((pattern) => pattern.test(folded)),
    )?.id ?? null
  );
}

// ---------------------------------------------------------------------------
// Employers
// ---------------------------------------------------------------------------

/** What „Nie ma na liście” asks a reader to say an institution is. */
export const employerTextKinds = [
  "urzad",
  "szkola",
  "pomoc_spoleczna",
  "kultura_sport",
  "spolka",
  "inna",
] as const;
export type EmployerTextKind = (typeof employerTextKinds)[number];

export const employerTextKindLabels: Record<EmployerTextKind, string> = {
  urzad: "Urząd",
  szkola: "Szkoła",
  pomoc_spoleczna: "Pomoc społeczna",
  kultura_sport: "Kultura i sport",
  spolka: "Spółka",
  inna: "Inna",
};

/** The chips offered for an institution a reader typed by name. */
export function institutionOfTextKind(kind: EmployerTextKind): InstitutionKind {
  if (kind === "szkola") return "szkola";
  if (kind === "spolka") return "spolka";
  return "jednostka";
}

/** An employer as a reader or the machine names it: a public bodies catalogue
 * row by REGON, a place already on the site, or a name typed with its kind
 * because neither has it. */
export type EmployerRef =
  | { regon: string }
  | { place: string }
  | { text: string; kind: EmployerTextKind };

const STREET =
  /(^|[\s,(])(ul|ulica|al|aleja|aleje|os|osiedle|pl|plac)(\.\s*|\s+)\S.*\d/i;
const POSTAL_CODE = /\b\d{2}-\d{3}\b/;

/** Whether typed text reads as an address: a street, square or estate with a
 * number, or a postal code. Nobody types one: a name is enough, and a home
 * address is not public. */
export function looksLikeAddress(text: string): boolean {
  return STREET.test(text) || POSTAL_CODE.test(text);
}

/** Where catalogue REGONs lead on the site. */
export type EmployerLookup = {
  /** Live places by their `regonNumber`. */
  placeByRegon: ReadonlyMap<string, string>;
  /** Live places by their `krsNumber`, without its leading zeros. */
  placeByKrs: ReadonlyMap<string, string>;
  /** The KRS number of a REGON's company: the catalogue row's own, or the
   * register's. */
  krsByRegon: ReadonlyMap<string, string>;
};

/** A KRS number without the zeros the register pads it to ten digits with,
 * so "0000071567" and "71567" are one company. */
function krsKey(krs: unknown): string | null {
  if (typeof krs !== "string" && typeof krs !== "number") return null;
  const digits = String(krs).replace(/\D/g, "").replace(/^0+/, "");
  return digits || null;
}

function regonKey(regon: unknown): string | null {
  if (typeof regon !== "string") return null;
  const digits = normalizeRegon(regon);
  return /^(\d{9}|\d{14})$/.test(digits) ? digits : null;
}

/** The lookup `employerKey` reads, from live places and the KRS numbers of
 * catalogue rows. Where two places share a number, the first one given
 * wins. */
export function employerLookup(
  args: {
    places?: Iterable<{
      id: string;
      regonNumber?: unknown;
      krsNumber?: unknown;
    }>;
    krsByRegon?: Iterable<readonly [regon: string, krs: string]>;
  } = {},
): EmployerLookup {
  const placeByRegon = new Map<string, string>();
  const placeByKrs = new Map<string, string>();
  const krsByRegon = new Map<string, string>();
  for (const place of args.places ?? []) {
    const regon = regonKey(place.regonNumber);
    if (regon && !placeByRegon.has(regon)) placeByRegon.set(regon, place.id);
    const krs = krsKey(place.krsNumber);
    if (krs && !placeByKrs.has(krs)) placeByKrs.set(krs, place.id);
  }
  for (const [regon, krs] of args.krsByRegon ?? []) {
    const key = regonKey(regon);
    const number = krsKey(krs);
    if (key && number && !krsByRegon.has(key)) krsByRegon.set(key, number);
  }
  return { placeByRegon, placeByKrs, krsByRegon };
}

/** The employer as readers' answers are compared by, and what an agreed row
 * names: a place where the REGON leads to one, by its own number or its
 * company's KRS number, so a page's KRS place and its catalogue row are one
 * employer. */
function resolveEmployer(
  employer: EmployerRef,
  lookup?: EmployerLookup,
): { key: string; employer: EmployerRef } {
  if ("place" in employer) {
    return { key: `place:${employer.place}`, employer };
  }
  if ("regon" in employer) {
    const regon = regonKey(employer.regon) ?? normalizeRegon(employer.regon);
    const krs = lookup?.krsByRegon.get(regon);
    const place =
      lookup?.placeByRegon.get(regon) ??
      (krs ? lookup?.placeByKrs.get(krs) : undefined);
    return place
      ? { key: `place:${place}`, employer: { place } }
      : { key: `regon:${regon}`, employer: { regon } };
  }
  return {
    key: `text:${normalizePersonName(employer.text)}|${employer.kind}`,
    employer: { text: employer.text.trim(), kind: employer.kind },
  };
}

/** `place:<id>` when the employer is or leads to a place, else
 * `regon:<REGON>`, else `text:<folded name>|<kind>`. */
export function employerKey(
  employer: EmployerRef,
  lookup?: EmployerLookup,
): string {
  return resolveEmployer(employer, lookup).key;
}

/** The family a row is keyed by: its chip's, or for „Inne” the family its
 * text folds to, else the folded text itself. */
function rowFamily(row: { role: string; other?: string | null }): string {
  const chip = CHIPS.get(row.role);
  if (chip?.family) return chip.family;
  if (row.role !== OTHER_ROLE) return `role:${row.role}`;
  return (
    roleFamilyOf(row.other) ?? `inne:${normalizePersonName(row.other ?? "")}`
  );
}

/** What readers' rows are compared by: the employer and the role's family,
 * so „prezes” and „członek zarządu” at one company are one row, as the
 * register's „Zarząd” is one seat. */
export function rowKey(
  row: { employer: EmployerRef; role: string; other?: string | null },
  lookup?: EmployerLookup,
): string {
  return `${employerKey(row.employer, lookup)}#${rowFamily(row)}`;
}

// ---------------------------------------------------------------------------
// The upload
// ---------------------------------------------------------------------------

/** A day or a year from 1900 to 2100, as `readingKind` reads it. */
function isReadingDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  return readingKind(value) !== null && year >= 1900 && year <= 2100;
}

const readingDate = z
  .string()
  .refine(isReadingDate, "YYYY-MM-DD or YYYY, from 1900 to 2100");

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "a sha256 in hex");

const regonSchema = z
  .string()
  .trim()
  .max(20)
  .transform((raw) => normalizeRegon(raw))
  .refine((digits) => isValidRegon(digits), "a REGON with its check digit");

const placeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "a node id");

const roleIdSchema = z
  .string()
  .refine((id) => CHIPS.has(id), "a role chip's id");

/** Text a reader typed: a name, never an address. */
const typedName = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !looksLikeAddress(text), "Bez adresu - tylko nazwa.");

/** A date the machine read, and how sure OCR was of it, 0 to 1. */
const machineDateSchema = z
  .object({ value: readingDate, score: z.number().min(0).max(1) })
  .strict();
export type MachineDate = z.infer<typeof machineDateSchema>;

/** A suggestion the machine makes for a printed band: a catalogue REGON or a
 * place, and a role chip, never text. */
export const suggestionSchema = z
  .object({
    employer: z.union([
      z.object({ regon: regonSchema }).strict(),
      z.object({ place: placeIdSchema }).strict(),
    ]),
    role: roleIdSchema.refine((id) => id !== OTHER_ROLE, "a listed role"),
  })
  .strict();
export type EmploymentSuggestion = z.infer<typeof suggestionSchema>;

const stripSchema = z
  .object({
    /** The declaration page it is cut from, 0-based: a band can run across
     * a page break. */
    page: z.number().int().min(0).max(500),
    png: base64Png,
  })
  .strict();

/** A written line, as the y-range it takes on one strip, in pixels. */
const lineSchema = z
  .object({
    strip: z
      .number()
      .int()
      .min(0)
      .max(MAX_STRIPS - 1),
    top: z.number().int().min(0).max(20_000),
    bottom: z.number().int().min(1).max(20_000),
  })
  .strict()
  .refine((line) => line.bottom > line.top, "a line ends below its top");

const bandFields = {
  /** Printed rather than handwritten, as OCR's scores say. */
  typed: z.boolean(),
  /** The pictures, in reading order, tiling the band without a gap. */
  strips: z.array(stripSchema).min(1).max(MAX_STRIPS),
  lines: z.array(lineSchema).max(MAX_LINES).default([]),
};

const linesOnStrips = (band: {
  strips: readonly unknown[];
  lines: readonly { strip: number }[];
}) => band.lines.every((line) => line.strip < band.strips.length);

/** The header strip: the title with its function list, the „stanu na” line
 * where the form has one, the „dnia” line and any receipt stamp. Never the
 * name or the birth date. */
export const headerBandSchema = z
  .object({
    ...bandFields,
    /** „według stanu na dzień”, as OCR read it. */
    asOf: machineDateSchema.nullable().default(null),
    /** „dnia”, the day the form was signed, as OCR read it. */
    filedOn: machineDateSchema.nullable().default(null),
  })
  .strict()
  .refine(linesOnStrips, "a line on a strip the band does not have");

/** A band readers read: the employer line from under the birth date to its
 * caption, or section VII or VIII from caption to caption. */
export const readingBandSchema = z
  .object({
    ...bandFields,
    /** What the band's card shows, its header included: answers record it,
     * and an answer to another picture has no voice. */
    imageHash: sha256Hex,
    /** Only on a printed band. */
    suggestions: z.array(suggestionSchema).max(MAX_SUGGESTIONS).default([]),
  })
  .strict()
  .refine(linesOnStrips, "a line on a strip the band does not have")
  .refine(
    (band) => band.typed || band.suggestions.length === 0,
    "suggestions only on a printed band",
  );

/** One declaration's pictures and the machine's reading of them, for the
 * date page `id` whose date crop the site has. */
export const employmentItemSchema = z
  .object({
    /** `<sha256>-p<page>`: the date page's `declarationExtracts` id. */
    id: z.string().regex(EXTRACT_ID_PATTERN, "<sha256>-p<page>"),
    /** EMPLOYMENT_CUT_VERSION of the cut that made the pictures. */
    cutVersion: z.number().int().min(1).max(10_000),
    /** An older declaration of a person whose newest one is read first. */
    later: z.boolean().default(false),
    header: headerBandSchema,
    employer: readingBandSchema.optional(),
    vii: readingBandSchema.optional(),
    viii: readingBandSchema.optional(),
  })
  .strict()
  .refine((item) => readingBands.some((band) => item[band]), "a band to read");
export type EmploymentItemInput = z.infer<typeof employmentItemSchema>;

/** `POST /api/ingest/declarations/employment`. */
export const employmentIngestSchema = z
  .object({
    /** What made the batch, so a bad one can be found and sent again. */
    tag: z.string().min(1).max(80),
    runId: z.string().min(1).max(80).optional(),
    items: z
      .array(employmentItemSchema)
      .max(MAX_EXTRACTS_PER_REQUEST)
      .default([]),
  })
  .strict();
export type EmploymentIngest = z.infer<typeof employmentIngestSchema>;

/** Why an item was not stored: no date page has its id (an item never
 * creates one), a picture is not a PNG within `MAX_IMAGE_BYTES`, or a band's
 * pictures with its header's are over `MAX_BAND_PICTURE_BYTES`. */
export type EmploymentIngestSkipReason =
  "unknown_extract" | "bad_image" | "too_large";

export type EmploymentIngestResult = {
  status: "ok";
  /** Bands stored for the first time; changed; sent with a new picture that
   * was not stored because readers answered the one before; sent again as
   * they were. */
  bands: { created: number; updated: number; kept: number; unchanged: number };
  skipped: { id: string; reason: EmploymentIngestSkipReason }[];
};

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** `read`: rows; `none`: „Brak”, the line names no post; `unreadable`:
 * „Nieczytelne”. A skip only hides the item from this reader, and has no
 * voice. */
export const employmentVerdicts = [
  "read",
  "none",
  "unreadable",
  "skip",
] as const;
export type EmploymentVerdict = (typeof employmentVerdicts)[number];

/** Where a row came from: the reader added it, accepted the machine's or the
 * page's own suggestion, or read the post off the header's title. */
export const rowSources = ["typed", "machine", "page", "title"] as const;
export type RowSource = (typeof rowSources)[number];

/** The kind of declaration as readers pick it, for a „stan na” that is not
 * 31 December: one at the start of a term, at its end, or another. */
export const declarationKindChips = ["start", "end", "other"] as const;
export type DeclarationKindChip = (typeof declarationKindChips)[number];

/** A declaration's kind: annual when its „stan na” is 31 December or a bare
 * year, else as readers agreed. */
export const declarationKinds = ["annual", ...declarationKindChips] as const;
export type DeclarationKind = (typeof declarationKinds)[number];

/** „Zgłoś problem”: none of them a vote. */
export const employmentFlags = [
  "missing_part",
  "other_person",
  "home_address",
] as const;
export type EmploymentFlag = (typeof employmentFlags)[number];

export const employerSchema = z.union([
  z.object({ regon: regonSchema }).strict(),
  z.object({ place: placeIdSchema }).strict(),
  z.object({ text: typedName(200), kind: z.enum(employerTextKinds) }).strict(),
]);

export const employmentRowSchema = z
  .object({
    employer: employerSchema,
    role: roleIdSchema,
    /** „Inne”: the role as written. Stays on the reading. */
    other: typedName(120).optional(),
    /** „od kiedy”. */
    start: readingDate.optional(),
    /** „Niepewne”: the row and its date are no voice. */
    unsure: z.boolean().optional(),
    source: z.enum(rowSources),
    /** The reader changed a suggestion before keeping it. */
    changed: z.boolean().optional(),
  })
  .strict()
  .refine((row) => (row.role === OTHER_ROLE) === (row.other !== undefined), {
    message: "„Inne” takes the role as written, and only „Inne” does",
    path: ["other"],
  });
export type EmploymentRow = z.infer<typeof employmentRowSchema>;

/** `POST /api/declarations/employment/<id>/answer`. */
export const employmentAnswerSchema = z
  .object({
    verdict: z.enum(employmentVerdicts),
    rows: z.array(employmentRowSchema).max(MAX_ROWS).default([]),
    /** „Stan na” as typed: a day or a year. */
    asOf: readingDate.optional(),
    /** „Tak jest w oryginale”: a date that does not exist, kept as written
     * for an admin. No voice. */
    asOfRaw: z.string().trim().min(1).max(40).optional(),
    /** „Nie widać”. No voice. */
    asOfUnseen: z.boolean().optional(),
    /** „Niepewne” on „Stan na”: the date and the kind are no voice. */
    asOfUnsure: z.boolean().optional(),
    declarationKind: z.enum(declarationKindChips).optional(),
    flags: z
      .array(z.enum(employmentFlags))
      .max(employmentFlags.length)
      .default([])
      .refine((flags) => new Set(flags).size === flags.length, "each once"),
    /** What the reader did with each suggestion shown: „Tak”, „Nie”, or
     * nothing. */
    suggestions: z
      .array(
        z
          .object({
            source: z.enum(["machine", "page"]),
            answer: z.enum(["yes", "no", "none"]),
          })
          .strict(),
      )
      .max(MAX_SUGGESTIONS_SHOWN)
      .default([]),
    msOnCard: z.number().int().min(0).max(3_600_000).optional(),
    /** The picture the reader was shown. */
    imageHash: sha256Hex.optional(),
  })
  .strict()
  .refine(
    (answer) =>
      answer.verdict === "read"
        ? answer.rows.length > 0
        : answer.rows.length === 0,
    { message: "rows with a reading, and only with one", path: ["rows"] },
  )
  .refine(
    (answer) =>
      answer.verdict === "read" ||
      (answer.asOf === undefined &&
        answer.asOfRaw === undefined &&
        !answer.asOfUnseen &&
        answer.declarationKind === undefined),
    { message: "a date only with a reading", path: ["asOf"] },
  )
  .refine(
    (answer) =>
      [answer.asOf, answer.asOfRaw, answer.asOfUnseen || undefined].filter(
        (value) => value !== undefined,
      ).length <= 1,
    { message: "one of a date, the date as written or „Nie widać”" },
  );
export type EmploymentAnswer = z.infer<typeof employmentAnswerSchema>;

/** An answer as `declarationAnswers` stores it. No `extractId` and no
 * `counted`: the date flow's tallies never see it. */
export type StoredEmploymentAnswer<Time = string> = Omit<
  EmploymentAnswer,
  "imageHash"
> & {
  kind: "employment";
  /** The item: the date page's `declarationExtracts` id. */
  employmentOf: string;
  band: ReadingBand;
  uid: string;
  /** Whether the answer has a say, as for a date answer. */
  votes: boolean;
  /** Served as a Kontrola read: it settles nothing. */
  control?: boolean;
  /** The Warsaw day it was given. */
  day: string;
  imageHash: string | null;
  at: Time;
  /** Edges the agreement this answer was part of wrote. */
  addedEdgeIds?: string[];
};

// ---------------------------------------------------------------------------
// Reading state
// ---------------------------------------------------------------------------

/**
 * Where a band's reading is.
 *
 * - `waiting`: stored, until its date crop agreed and named exactly one live
 *   page.
 * - `later`: an older declaration of a person whose newest one is read first.
 * - `open`: served to readers.
 * - `agreed`, `unreadable`, `disputed`: settled; a disputed one goes to an
 *   admin.
 * - `recut`: off the queue until its band is cut again, wider.
 * - `withdrawn`: taken back by an admin, or its page link broke before it
 *   applied.
 */
export const employmentStatuses = [
  "waiting",
  "later",
  "open",
  "agreed",
  "unreadable",
  "disputed",
  "recut",
  "withdrawn",
] as const;
export type EmploymentStatus = (typeof employmentStatuses)[number];

export const settledEmploymentStatuses = [
  "agreed",
  "unreadable",
  "disputed",
] as const satisfies readonly EmploymentStatus[];

/**
 * Where writing an agreed reading to the graph is.
 *
 * - `pending`: agreed, not written yet.
 * - `planned`: writes are off; `plan` says what would be written.
 * - `waiting`: written where it could be; a row waits on a draft place or a
 *   register edge, and is tried again.
 * - `applied`: every row written, or skipped for a reason only a decision or
 *   an admin changes.
 * - `withdrawn`: its entries taken off the edges again.
 */
export const employmentApplyStates = [
  "pending",
  "planned",
  "waiting",
  "applied",
  "withdrawn",
] as const;
export type EmploymentApplyState = (typeof employmentApplyStates)[number];

/**
 * Why an agreed row was not written.
 *
 * - `awaits_mayor_decision`: the declarant's own elected office.
 * - `not_managerial`: a staff post.
 * - `unresolved`: an institution typed by name, not in the catalogue.
 * - `ambiguous`: several of the person's edges could be the post, an edge to
 *   the region the place serves, or an undated one whose name folds to no
 *   family.
 * - `board_awaits_register`: a seat at a KRS company the register does not
 *   record.
 * - `removed`: the matching edge was deleted, which is final.
 * - `krs_registered`, `ownership_unknown`, `name_taken`, `place_draft`: a
 *   catalogue row the site does not create a place from: one in KRS, one
 *   whose ownership is private or not given, a name a place without KRS
 *   already has, or a contributor's draft with that REGON.
 * - `other_role`, `role_unsettled`, `as_of_unsettled`: what an entry on an
 *   edge needs is missing (`entryGap`): the role is „Inne”, readers agreed on
 *   the post's family but not on its chip, or not on „Stan na”.
 */
export const employmentSkipReasons = [
  "awaits_mayor_decision",
  "not_managerial",
  "unresolved",
  "ambiguous",
  "board_awaits_register",
  "removed",
  "krs_registered",
  "ownership_unknown",
  "name_taken",
  "place_draft",
  "other_role",
  "role_unsettled",
  "as_of_unsettled",
] as const;
export type EmploymentSkipReason = (typeof employmentSkipReasons)[number];

/**
 * Why an agreed row cannot be written as an entry on an edge, or null when
 * it can. An entry carries its chip and „Stan na” (`DeclaredPost.role`,
 * `roleId` and `as_of`), so apply parks a row without them on „Do
 * ustalenia”: „Inne” (`other_role`), a chip readers did not agree on within
 * the family (`role_unsettled`), then a „Stan na” they did not agree on
 * (`as_of_unsettled`), which is the whole reading's. Whether readers type
 * „Stan na” at all is still open, so settling never waits on it.
 */
export function entryGap(
  row: Pick<AgreedEmploymentRow, "role">,
  asOf: string | null,
): Extract<
  EmploymentSkipReason,
  "other_role" | "role_unsettled" | "as_of_unsettled"
> | null {
  if (row.role === OTHER_ROLE) return "other_role";
  if (!row.role || !CHIPS.has(row.role)) return "role_unsettled";
  if (!asOf || !readingKind(asOf)) return "as_of_unsettled";
  return null;
}

/** The machine's reading of a printed item. */
export type EmploymentMachine = {
  suggestions: EmploymentSuggestion[];
  asOf: MachineDate | null;
  filedOn: MachineDate | null;
};

/** What a band's answers add up to: readers with a voice, and for each row
 * key those for it, against it and unsure of it. */
export type EmploymentTally = {
  voices: number;
  none: number;
  unreadable: number;
  rows: Record<string, { for: number; against: number; unsure: number }>;
  /** „Stan na” as typed, by readers sure of it. */
  asOf: Record<string, number>;
};

/** One row readers agreed on. */
export type AgreedEmploymentRow = {
  /** `rowKey`: the employer and the role's family. */
  key: string;
  employer: EmployerRef;
  family: string;
  /** The chip readers agreed on; null when they picked different chips of
   * one family, and then no entry is written (`role_unsettled`). */
  role: string | null;
  /** „Inne” as written, when readers agreed on it. */
  other: string | null;
  /** „od”, when readers agreed on it. */
  start: string | null;
  /** Readers for the row. */
  readers: number;
};

export type EmploymentAgreed<Time = string> = {
  /** None: the line names no post, which says nothing of any other. */
  rows: AgreedEmploymentRow[];
  /** „Stan na”, when readers agreed on it; without it no row is written
   * (`as_of_unsettled`). */
  asOf: string | null;
  kind: DeclarationKind | null;
  readers: number;
  by: "readers" | "admin";
  at: Time;
};

/** An admin's decision on a band, with what it replaced. */
export type EmploymentDecision<Time = string> = {
  action: "accept" | "correct" | "unreadable" | "withdraw";
  by: string;
  at: Time;
  before: {
    status: EmploymentStatus;
    agreed: EmploymentAgreed<Time> | null;
  };
};

/** What applying a band wrote: the `declared` keys, the edges they are on,
 * the edges and places it created, the rows it skipped, and the page it put
 * back in the publication queue. */
export type EmploymentApplied<Time = string> = {
  keys: string[];
  edges: string[];
  created: string[];
  places: string[];
  skipped: { row: number; reason: EmploymentSkipReason }[];
  requeued: string | null;
  at: Time;
};

/** What applying would write while writes are off, a line per row. */
export type EmploymentPlanRow = {
  row: number;
  action: "create" | "annotate" | "skip";
  /** The edge it would write to, where one exists. */
  edge: string | null;
  /** The place, or the REGON of a place it would create. */
  place: string | null;
  regon: string | null;
  reason: EmploymentSkipReason | null;
  /** The person's page would go back to the publication queue. */
  requeue: boolean;
};

/** Kontrola: an agreed band read once more, blind, by another voting
 * reader. */
export type EmploymentControl<Time = string> = {
  state: "due" | "served" | "same" | "different";
  uid: string | null;
  at: Time | null;
};

/** One band's reading, as the map on `declarationExtracts` holds it. */
export type EmploymentState<Time = string> = {
  status: EmploymentStatus;
  /** The one live page the item reads for, followed through merges. */
  personId: string | null;
  /** `employmentPriority`. */
  priority: number;
  rand: number;
  /** Answers with a voice. */
  answerCount: number;
  typed: boolean;
  /** Only for a printed band. */
  machine: EmploymentMachine | null;
  imageHash: string;
  cutVersion: number;
  summary: EmploymentTally | null;
  agreed: EmploymentAgreed<Time> | null;
  decision: EmploymentDecision<Time> | null;
  applyState: EmploymentApplyState | null;
  skipReason: EmploymentSkipReason | null;
  applied: EmploymentApplied<Time> | null;
  plan: EmploymentPlanRow[] | null;
  control: EmploymentControl<Time> | null;
  /** „Zgłoś problem” reports, by kind. */
  flags: Partial<Record<EmploymentFlag, number>>;
  updatedAt: Time;
};

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

/** One answer, as much of it as settling reads. */
export type EmploymentVote = {
  uid: string;
  verdict: EmploymentVerdict;
  rows?: readonly {
    employer: EmployerRef;
    role: string;
    other?: string | null;
    start?: string | null;
    unsure?: boolean | null;
  }[];
  asOf?: string | null;
  asOfUnsure?: boolean | null;
  declarationKind?: string | null;
  votes?: boolean;
  control?: boolean | null;
  imageHash?: string | null;
};

export type EmploymentSettlement =
  | { status: "open"; tally: EmploymentTally }
  | {
      status: "agreed";
      tally: EmploymentTally;
      rows: AgreedEmploymentRow[];
      asOf: string | null;
      kind: DeclarationKind | null;
      /** Readers who gave rows or „Brak”. */
      readers: number;
    }
  | { status: "unreadable"; tally: EmploymentTally; readers: number }
  | { status: "disputed"; tally: EmploymentTally };

type RowRead = {
  employer: EmployerRef;
  family: string;
  role: string;
  other: string | null;
  start: string | null;
};

/** One reader's voice: the rows they are sure of, by key, and the keys they
 * gave only unsure rows for. */
type Voice = {
  uid: string;
  verdict: "read" | "none" | "unreadable";
  sure: Map<string, RowRead>;
  unsure: Set<string>;
  asOf: string | null;
  declarationKind: string | null;
};

type Voiced = EmploymentVote & { verdict: Voice["verdict"] };

function voiceOf(answer: Voiced, lookup?: EmployerLookup): Voice {
  const sure = new Map<string, RowRead>();
  const unsure = new Set<string>();
  if (answer.verdict === "read") {
    for (const row of answer.rows ?? []) {
      const resolved = resolveEmployer(row.employer, lookup);
      const family = rowFamily(row);
      const key = `${resolved.key}#${family}`;
      if (row.unsure) {
        unsure.add(key);
        continue;
      }
      if (sure.has(key)) continue;
      sure.set(key, {
        employer: resolved.employer,
        family,
        role: row.role,
        other: row.other?.trim() || null,
        start: row.start && readingKind(row.start) ? row.start : null,
      });
    }
    for (const key of sure.keys()) unsure.delete(key);
  }
  const dated = !answer.asOfUnsure;
  return {
    uid: answer.uid,
    verdict: answer.verdict,
    sure,
    unsure,
    asOf: dated && answer.asOf && readingKind(answer.asOf) ? answer.asOf : null,
    declarationKind: (dated && answer.declarationKind) || null,
  };
}

/** The value at least `agree` voices gave, leading every other value by as
 * many; null when none does. */
function settleChoice(
  values: readonly (string | null)[],
  agree: number,
): string | null {
  const given = values.filter((value): value is string => !!value);
  const counts = new Map<string, number>();
  for (const value of given) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const [value, count] of counts) {
    if (count >= agree && count - (given.length - count) >= agree) {
      return value;
    }
  }
  return null;
}

/** A date the voices agree on by `settleReading`'s rule: a year typed alone
 * supports the days in it. */
function settleDate(
  voices: readonly { uid: string; value: string | null }[],
  agree: number,
): string | null {
  const settled = settleReading(
    voices.flatMap(({ uid, value }) =>
      value ? [{ uid, verdict: "date" as const, value }] : [],
    ),
    { agree, disputedAfter: Number.POSITIVE_INFINITY },
  );
  return settled.status === "agreed" ? settled.value : null;
}

/** Whether an answer is a voice: not a skip, not a Kontrola read, and given
 * to the picture the band has now. */
function isVoice(
  answer: EmploymentVote,
  imageHash: string | null | undefined,
): answer is Voiced {
  return (
    answer.verdict !== "skip" &&
    !answer.control &&
    (!answer.imageHash || !imageHash || answer.imageHash === imageHash)
  );
}

/**
 * What a band's answers settle.
 *
 * One voice per reader, by their last answer, and only from answers with a
 * say (`answerVotes`): not automated, not given without a vote. A skip, a
 * Kontrola read and an answer to a picture the band has since been cut
 * again from (`imageHash`) are no voice. The machine never is one.
 *
 * Rows are compared by `rowKey`, with `lookup` telling where a REGON leads. A
 * row is accepted when at least `agree` readers are sure of it and lead
 * those against it by as many, and rejected when those against lead by as
 * many: 2-0 and 3-1 settle, 2-1 waits. Against a row are „Brak” and readings
 * sure of other rows without it. A row marked „Niepewne” is no voice for or
 * against it, nor is a reading of unsure rows only against anything.
 *
 * The band is agreed once every row anybody gave is accepted or rejected,
 * and a row is accepted or „Brak” wins as a row would, over the readings
 * sure of any row. Agreed with no row says the line names no post, not that
 * the person holds none. „Stan na”, the kind of declaration and each row's
 * „od” and chip then settle field by field among the readers behind the
 * accepted rows, by `settleReading`'s rule for dates; a field that does not
 * settle is null.
 *
 * Unreadable: one more „Nieczytelne” than it takes to agree, and no row with
 * `agree` readers sure of it. Disputed: `disputedAfter` voices without
 * either.
 */
export function settleEmployment(
  answers: readonly EmploymentVote[],
  options: {
    lookup?: EmployerLookup;
    /** The band's picture now. */
    imageHash?: string | null;
    agree?: number;
    disputedAfter?: number;
  } = {},
): EmploymentSettlement {
  const agree = options.agree ?? READERS_TO_AGREE;
  const disputedAfter = options.disputedAfter ?? DISPUTED_AFTER;

  const byReader = new Map<string, EmploymentVote>();
  for (const answer of answers) {
    if (answerVotes(answer)) byReader.set(answer.uid, answer);
  }
  const voices = [...byReader.values()]
    .filter((answer) => isVoice(answer, options.imageHash))
    .map((answer) => voiceOf(answer, options.lookup));
  const reads = voices.filter((voice) => voice.verdict === "read");
  const none = voices.filter((voice) => voice.verdict === "none").length;
  const unreadable = voices.filter(
    (voice) => voice.verdict === "unreadable",
  ).length;

  const keys = new Set(
    reads.flatMap((voice) => [...voice.sure.keys(), ...voice.unsure]),
  );
  const rows: EmploymentTally["rows"] = {};
  const accepted: string[] = [];
  let undecided = 0;
  let strongest = 0;
  for (const key of keys) {
    const support = reads.filter((voice) => voice.sure.has(key)).length;
    const unsure = reads.filter((voice) => voice.unsure.has(key)).length;
    const against =
      none +
      reads.filter(
        (voice) =>
          voice.sure.size > 0 && !voice.sure.has(key) && !voice.unsure.has(key),
      ).length;
    rows[key] = { for: support, against, unsure };
    strongest = Math.max(strongest, support);
    if (support >= agree && support - against >= agree) accepted.push(key);
    else if (against - support < agree) undecided += 1;
  }
  const asOf: Record<string, number> = {};
  for (const voice of reads) {
    if (voice.asOf) asOf[voice.asOf] = (asOf[voice.asOf] ?? 0) + 1;
  }
  const tally: EmploymentTally = {
    voices: voices.length,
    none,
    unreadable,
    rows,
    asOf,
  };

  // With no row accepted, „Brak” has to win as a row would: rows rejected
  // because every reader gave another one are no agreement that there is
  // none.
  const sureReads = reads.filter((voice) => voice.sure.size > 0).length;
  const noPost = none >= agree && none - sureReads >= agree;
  const answered = reads.length + none;
  if (undecided === 0 && (accepted.length > 0 || noPost)) {
    const behind = new Map<string, Voice>();
    const agreedRows = accepted
      .map((key) => {
        const voters = reads.filter((voice) => voice.sure.has(key));
        for (const voice of voters) behind.set(voice.uid, voice);
        return agreedRow(
          key,
          voters.map((voice) => ({
            uid: voice.uid,
            row: voice.sure.get(key)!,
          })),
          agree,
        );
      })
      .sort((a, b) => b.readers - a.readers || a.key.localeCompare(b.key));
    const backers = [...behind.values()];
    const settledAsOf = agreedRows.length
      ? settleDate(
          backers.map((voice) => ({ uid: voice.uid, value: voice.asOf })),
          agree,
        )
      : null;
    return {
      status: "agreed",
      tally,
      rows: agreedRows,
      asOf: settledAsOf,
      kind: agreedRows.length
        ? declarationKindOf(
            settledAsOf,
            backers.map((voice) => voice.declarationKind),
            agree,
          )
        : null,
      readers: answered,
    };
  }
  if (unreadable >= agree + 1 && strongest < agree) {
    return { status: "unreadable", tally, readers: unreadable };
  }
  if (voices.length >= disputedAfter) return { status: "disputed", tally };
  return { status: "open", tally };
}

function agreedRow(
  key: string,
  voters: readonly { uid: string; row: RowRead }[],
  agree: number,
): AgreedEmploymentRow {
  const first = voters[0]!.row;
  const role = settleChoice(
    voters.map(({ row }) => row.role),
    agree,
  );
  const others =
    role === OTHER_ROLE
      ? voters.filter(({ row }) => row.role === OTHER_ROLE)
      : [];
  const other = settleChoice(
    others.map(({ row }) => normalizePersonName(row.other ?? "")),
    agree,
  );
  return {
    key,
    employer: first.employer,
    family: first.family,
    role,
    other:
      other === null
        ? null
        : (others.find(
            ({ row }) => normalizePersonName(row.other ?? "") === other,
          )?.row.other ?? null),
    start: settleDate(
      voters.map(({ uid, row }) => ({ uid, value: row.start })),
      agree,
    ),
    readers: voters.length,
  };
}

/** Annual for a „stan na” on 31 December or a bare year; else the kind
 * readers agreed on, or null. */
function declarationKindOf(
  asOf: string | null,
  chips: readonly (string | null)[],
  agree: number,
): DeclarationKind | null {
  if (asOf && (readingKind(asOf) === "year" || asOf.endsWith("-12-31"))) {
    return "annual";
  }
  const settled = settleChoice(chips, agree);
  return declarationKindChips.find((chip) => chip === settled) ?? null;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/** How far back a sitting mayor's item goes while whether their own office
 * counts is undecided: their line most often names that office. */
export const SITTING_MAYOR_DELAY = 0.5;

/** How far back a Kontrola read goes: behind the first readings of its
 * tier. */
export const CONTROL_DELAY = 0.9;

/**
 * The `priority` an item is served by, lowest first; the queue then takes
 * the most answered, then `rand`.
 *
 * - 0: a draft held for having no paid public post, which a declared post can
 *   publish. Not one an admin declined: the queue would hold it again.
 * - 1: any other draft without a paid public post.
 * - 2: a public page without one.
 * - 3: a page with one.
 */
export function employmentPriority(args: {
  page: { published?: unknown; deleted?: unknown };
  /** `pagesWithAPublicPost`. */
  paidPost: boolean;
  /** The page's `declarationPublications` record, where it has one. */
  publication?: {
    status?: unknown;
    reason?: unknown;
    declinedAt?: unknown;
  } | null;
  /** A sitting wójt, burmistrz or prezydent while whether that office counts
   * is undecided. */
  sittingMayor?: boolean;
  /** Served as a Kontrola read. */
  control?: boolean;
}): number {
  const publication = args.publication;
  const tier = args.paidPost
    ? 3
    : pageIsPublic(args.page)
      ? 2
      : publication?.status === "held" &&
          publication.reason === RULED_OUT &&
          !publication.declinedAt
        ? 0
        : 1;
  return (
    tier +
    (args.sittingMayor ? SITTING_MAYOR_DELAY : 0) +
    (args.control ? CONTROL_DELAY : 0)
  );
}
