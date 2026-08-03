import type { Article, Company, ElectionPosition, Person } from "./model";
import {
  isValidNip,
  isValidRegon,
  normalizeNip,
  normalizeRegon,
} from "./identifiers";
import { z } from "zod";

export const companyRequestSchema = z.object({
  krs: z.string(),
  name: z.string(),
  owners: z.array(z.string()).optional(),
  teryt: z.string().optional(),
  /** PKD codes from KRS, e.g. "86.10.Z" */
  activity: z.array(z.string()).optional(),
  /** Whether the public sector owns the company, as far as KRS shows — not
   * whether it is publicly traded. Only `true` is an assertion, see
   * `Company.isPublic`. */
  is_public: z.boolean().optional(),
});

export type CompanyRequest = {
  krs: string;
  name: string;
  owners?: string[];
  teryt?: string;
  activity?: string[];
  is_public?: boolean;
};

const employmentRequestSchema = z.object({
  krs: z.string(),
  role: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export type EmploymentRequest = {
  krs: string;
  role?: string;
  start?: string;
  end?: string;
};

const electionRequestSchema = z.object({
  party: z.string().optional(),
  /** The electoral committee, as the scrapers read it off the PKW listing
   * ("Komitet Wyborczy Prawo i Sprawiedliwość"), as opposed to `party`, which
   * is the abbreviation those get mapped onto. It has to be accepted here or
   * zod strips it: the pipeline has emitted it all along, which is why no
   * stored candidacy carries one. */
  committee: z.string().optional(),
  election_year: z.string().optional(),
  election_type: z.enum([
    "Samorząd",
    "Sejmik",
    "Rada miasta",
    "Rada gminy",
    "Rada powiatu",
    "Burmistrz",
    "Wójt",
    "Prezydent",
    "Sejm",
    "Senat",
    "Parlament Europejski",
  ]),
  teryt: z.string().optional(),
});

export type ElectionRequest = {
  party?: string;
  committee?: string;
  election_year?: string;
  election_type: ElectionPosition;
  teryt?: string;
};

export const personRequestSchema = z.object({
  name: z.string(),
  content: z.string().optional(),
  autoapprove: z.boolean().optional(),

  wikipedia: z.string().optional(),
  rejestrIo: z.string().optional(),
  parties: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  companies: z.array(employmentRequestSchema),
  elections: z.array(electionRequestSchema).optional(),
});

export type PersonRequest = {
  name: string;
  content?: string;
  autoapprove?: boolean;

  wikipedia?: string;
  rejestrIo?: string;
  parties?: Array<string>;
  sources?: Array<string>;
  companies: Array<EmploymentRequest>;
  elections?: Array<ElectionRequest>;
};

export type EntityResult = {
  nodeId: string;
  created: boolean;
  edgeId?: string;
  krs?: string;
};

/** Fields a user may propose for a person node, whether creating a new one
 * or editing an existing one.
 *
 * This is an allowlist rather than a denylist of internal fields: anything
 * not listed here is stripped by zod during parsing, so a caller can't smuggle
 * in e.g. `revision_id` or `stats` and have it written straight to the node.
 *
 * The `satisfies` clause couples this to the `Person` model: if a listed
 * field's type changes there, this schema stops typechecking until updated,
 * so the two can't silently drift apart.
 */
export const personEditSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana"),
  content: z.string().optional(),
  parties: z.array(z.string()).optional(),
  birthDate: z.string().optional(),
  wikipedia: z.string().optional(),
  rejestrIo: z.string().optional(),
  ktomaco: z.string().optional(),
}) satisfies z.ZodType<
  Pick<
    Person,
    | "name"
    | "content"
    | "parties"
    | "birthDate"
    | "wikipedia"
    | "rejestrIo"
    | "ktomaco"
  >
>;

export type PersonEditRequest = z.infer<typeof personEditSchema>;

/** A REGON or a NIP as typed, stored as bare digits.
 *
 * Both are checksummed, so a mistyped one can be rejected here instead of
 * being written to a node that nobody can then look up in the register. An
 * empty string is left alone: it is how the form clears a number that turned
 * out to be wrong.
 */
function identifierField(
  normalize: (raw: string) => string,
  isValid: (value: string) => boolean,
  register: string,
) {
  return z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : normalize(value)))
    .refine((value) => !value || isValid(value), {
      message: `Numer ${register} jest niepoprawny`,
    });
}

/** Fields a user may propose for a place node, on the same allowlist terms as
 * `personEditSchema`.
 *
 * `isPublic` is here because the scrapers cannot always answer it: KRS does not
 * list the shareholders of a spółka akcyjna, and an institution outside KRS has
 * no entry to read at all. Whoever submits an answer is recorded in
 * `isPublicSource`, which is what stops a later ingest from overwriting it.
 */
export const companyEditSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana"),
  content: z.string().optional(),
  krsNumber: z.string().optional(),
  regonNumber: identifierField(normalizeRegon, isValidRegon, "REGON"),
  nipNumber: identifierField(normalizeNip, isValidNip, "NIP"),
  isPublic: z.boolean().optional(),
}) satisfies z.ZodType<
  Pick<
    Company,
    "name" | "content" | "krsNumber" | "regonNumber" | "nipNumber" | "isPublic"
  >
>;

export type CompanyEditRequest = z.infer<typeof companyEditSchema>;

/** Fields a user may propose for an article node.
 *
 * Articles were only ever created by `ingest/article`, from a URL the scrapers
 * had already fetched, which left no way to enter the source a claim rests on
 * while writing the claim itself. `sourceURL` is what identifies an article -
 * the ingest looks entries up by it - so it is the one required field.
 */
export const articleEditSchema = z.object({
  name: z.string().min(1, "Tytuł jest wymagany"),
  content: z.string().optional(),
  sourceURL: z.string().url("Podaj pełny adres źródła"),
  shortName: z.string().optional(),
}) satisfies z.ZodType<
  Pick<Article, "name" | "content" | "sourceURL" | "shortName">
>;

export type ArticleEditRequest = z.infer<typeof articleEditSchema>;

/** The node types a person may propose from the site.
 *
 * Regions are left out: they come from the TERYT register, are complete, and
 * carry ids the rest of the data joins on.
 */
export const proposableNodeTypes = ["person", "place", "article"] as const;

export type ProposableNodeType = (typeof proposableNodeTypes)[number];

export const editSchemas = {
  person: personEditSchema,
  place: companyEditSchema,
  article: articleEditSchema,
} as const;

/** A proposal to take an entry down, which is a revision like any other and is
 * reviewed the same way. The reason is required because it is the only thing a
 * reviewer has to go on. */
export const removalSchema = z.object({
  deleted: z.literal(true),
  delete_reason: z.string().trim().min(1, "Powód usunięcia jest wymagany"),
});
