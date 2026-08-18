import type {
  Article,
  Company,
  ElectionPosition,
  Person,
  Topic,
} from "./model";
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
  /** Whether `party` was read off the scrapers' curated committee → party
   * table (`scrapers/pkw/elections.py`) rather than guessed.
   *
   * It is what decides whether a revision enriching an already-stored
   * candidacy is published outright or left for a reviewer. The table matches
   * exact committee names precisely because local committees borrow national
   * brands, so a hit is a human's judgement, already made; a miss is usually a
   * one-gmina KWW but is also where a newly-worded national committee hides.
   *
   * True for a coalition as well, where the map knows the committee but `party`
   * stays empty because a joint list names no single party. */
  party_from_committee: z.boolean().optional(),
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
  party_from_committee?: boolean;
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

/** What one institution paid one beneficiary under one aid programme, already
 * summed over its decisions.
 *
 * The summing happens in the pipeline rather than here because the ingest is
 * per beneficiary and a rollup has to be over everything the register holds for
 * the pair, not over the slice one request happens to carry.
 */
const aidGrantSchema = z.object({
  /** The granting institution's NIP. A starosta, a marszałek or a wojewódzki
   * fundusz has no KRS entry, so this is the only number every grantor has -
   * see `shared/identifiers.ts`. */
  grantor_nip: z.string(),
  grantor_name: z.string(),
  /** Ekwiwalent dotacji brutto in złoty, summed. What every ranking uses. */
  gross: z.number().nonnegative(),
  /** The nominal value, summed. Carried alongside `gross` and never instead of
   * it: for a deferral the nominal value is the whole deferred contribution
   * while the benefit is only the unpaid interest, so ranking on it is wrong.
   * Dropping it is also wrong - Martes Sport took one decision worth 872 k PLN
   * gross against 8.26 M PLN nominal, and gross alone makes that invisible. */
  nominal: z.number().nonnegative().optional(),
  decisions: z.number().int().positive(),
  first_decision: z.string().optional(),
  last_decision: z.string().optional(),
});

export type AidGrantRequest = z.infer<typeof aidGrantSchema>;

/** The person a sole trader's business belongs to, and where it is registered.
 *
 * Only ever somebody koryta.pl already tracks. Nothing in this ingest creates a
 * person: 2045 of the flood-aid beneficiaries are private individuals who had a
 * flood, and a register of those is not what the site is.
 *
 * `teryt` is the powiat the business sits in, and it is required because the
 * name on its own is worthless. Matching those 2045 sole traders against the
 * 6113 people on the site by name alone returns 21 hits and every one of them
 * is in a different powiat from the person it matched - Grzegorz Lach's firm
 * took 514 k PLN in powiat nyski while the councillor of that name sits in
 * powiat płocki. The endpoint re-checks the powiat against the person's own
 * region links rather than trusting the pipeline to have done it.
 */
const aidOwnerSchema = z.object({
  name: z.string().min(1),
  /** The person node the pipeline matched, checked rather than trusted. */
  node_id: z.string().min(1),
  /** Four digits: województwo and powiat. */
  teryt: z.string().regex(/^\d{4}$/, "Kod powiatu ma cztery cyfry"),
});

export type AidOwnerRequest = z.infer<typeof aidOwnerSchema>;

/** Public aid one beneficiary received under one programme, from however many
 * institutions.
 *
 * Every beneficiary in the register is accepted, sole traders included. An
 * earlier version required a KRS number, on the grounds that a sole trader has
 * no ownership register behind it and so could never gain an edge; that reading
 * was wrong about what makes a row worth keeping. The published analyses of
 * this data treat a run of eight or more decisions as the thing to look at, and
 * reading it by hand turns up single-decision micro-firms that are just as
 * interesting - and a filter that drops four in five beneficiaries drops those
 * before anybody can look.
 *
 * What the filter used to do, publication now does. Storing a row and putting
 * up a public page about it are separate decisions in this model (`published`
 * against `revision_id`), and `soleTrader` is what routes them: a company out
 * of KRS is published on arrival as `ingest/company` has always done, and a
 * natural person trading under their own name is stored and left for a
 * reviewer.
 */
export const aidRequestSchema = z.object({
  /** SUDOP's number for the programme ("SA.116730"). Part of the edge's
   * identity, so re-running the ingest for one programme cannot disturb what
   * another wrote. */
  measure: z.string().min(1),
  /** Required, and the only identifier that is. SUDOP addresses every
   * beneficiary by NIP and three quarters of them have nothing else, so this is
   * what a second run finds the node by. */
  nip: identifierField(normalizeNip, isValidNip, "NIP").refine(
    (value): value is string => !!value,
    { message: "Beneficjent musi mieć NIP" },
  ),
  krs: z.string().min(1).optional(),
  owner: aidOwnerSchema.optional(),
  name: z.string().min(1),
  teryt: z.string().optional(),
  /** Whether the beneficiary is a company in KRS or a natural person trading
   * under their own name, as the biała lista reports it. It decides what gets
   * published, not what gets stored - see `ingest/aid`. */
  soleTrader: z.boolean().optional(),
  /** PKD codes, in the same shape `ingest/company` takes them. */
  activity: z.array(z.string()).optional(),
  /** Structural signals, computed by `scrapers/sudop/signals.py`. An allowlist
   * rather than free text, so that a typo in the pipeline shows up here rather
   * than as a filter nobody can match. */
  signals: z
    .array(
      z.enum([
        "non_sme",
        "outside_flood_region",
        "capped_decision",
        "rare_grantor",
        "asset_light",
      ]),
    )
    .optional(),
  grants: z.array(aidGrantSchema).min(1),
});

export type AidRequest = z.infer<typeof aidRequestSchema>;

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

/** Fields a user may propose for a topic node, on the same allowlist terms as
 * `personEditSchema`.
 *
 * A topic carries no facts of its own - it is a name for a story, and what
 * belongs to it is said by the `tagged` edges pointing at it rather than by
 * anything stored here.
 */
export const topicEditSchema = z.object({
  name: z.string().min(1, "Nazwa tematu jest wymagana"),
  content: z.string().optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<Pick<Topic, "name" | "content" | "description">>;

export type TopicEditRequest = z.infer<typeof topicEditSchema>;

/** The node types a person may propose from the site.
 *
 * Regions are left out: they come from the TERYT register, are complete, and
 * carry ids the rest of the data joins on.
 */
export const proposableNodeTypes = [
  "person",
  "place",
  "article",
  "topic",
] as const;

export type ProposableNodeType = (typeof proposableNodeTypes)[number];

export const editSchemas = {
  person: personEditSchema,
  place: companyEditSchema,
  article: articleEditSchema,
  topic: topicEditSchema,
} as const;

/** A proposal to take an entry down, which is a revision like any other and is
 * reviewed the same way. The reason is required because it is the only thing a
 * reviewer has to go on. */
export const removalSchema = z.object({
  deleted: z.literal(true),
  delete_reason: z.string().trim().min(1, "Powód usunięcia jest wymagany"),
});
