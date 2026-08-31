import type {
  Article,
  Company,
  Edge,
  ElectionPosition,
  Person,
  Topic,
} from "./model";
import type { SupervisoryOrgan } from "./companyOrgans";
import { supervisoryOrgans } from "./companyOrgans";
import {
  isValidNip,
  isValidRegon,
  normalizeNip,
  normalizeRegon,
} from "./identifiers";
import { z } from "zod";
import { companyCategoryValues } from "./companyCategories";

export const companyRequestSchema = z.object({
  krs: z.string(),
  name: z.string(),
  owners: z.array(z.string()).optional(),
  /** TERYT codes of the gminy, powiaty and województwa that hold shares in the
   * company, as `scrapers.map.jst` resolved them from the register's own
   * wording. Separate from `owners` because a JST has no KRS number to look it
   * up by, and separate from `teryt` because owning a company and being the
   * town it is registered in are different claims - 252 companies are owned by
   * a local government that is not their own. */
  owner_teryts: z.array(z.string()).optional(),
  teryt: z.string().optional(),
  /** PKD codes from KRS, e.g. "86.10.Z" */
  activity: z.array(z.string()).optional(),
  /** Which sectors the company belongs to, decided by the pipelines in
   * `data/pipelines/src/entities/company_categories.py`.
   *
   * Not validated against `companyCategoryValues`: the pipelines and the site
   * deploy separately, so a payload naming a category this build has not heard
   * of yet is stored rather than rejected - the filter simply does not offer it
   * until `shared/companyCategories.ts` catches up. An empty array is a real
   * answer, meaning the pipelines looked and the company is in no sector.
   * Absent means they did not compute one at all, and the stored set is left
   * alone. */
  categories: z.array(z.string()).optional(),
  /** What the company's supervisory organ is called, decided by the pipelines
   * in `data/pipelines/src/entities/company_bodies.py` from the register's
   * `formaPrawna`.
   *
   * Not validated against `supervisoryBodyValues`, for the reason `categories`
   * is not: the pipelines and the site deploy separately. The empty string is
   * a real answer - "the register was read and this form has no organ worth
   * naming" - and clears whatever is stored, the way an empty `categories`
   * array does. Absent means the payload did not work it out and the stored
   * value is left alone. */
  supervisory_body: z.string().optional(),
  /** Whether the register names the Treasury among the company's shareholders.
   *
   * A flag rather than an entry in `owners` or `owner_teryts`, because the
   * Treasury is neither: it has no KRS number - it is not in the register at
   * all - and it is not a territory, so giving it a TERYT would let it compete
   * with real regions for the company's seat. The ingest resolves it to the
   * site's own „Skarb Państwa" node; see `SKARB_PANSTWA_NODE_ID`. */
  owner_skarb_panstwa: z.boolean().optional(),
  /** Whether the public sector owns the company, as far as KRS shows — not
   * whether it is publicly traded. Only `true` is an assertion, see
   * `Company.isPublic`. */
  is_public: z.boolean().optional(),
  /** `dzial1.danePodmiotu.formaPrawna`, verbatim - see `Company.legalForm`.
   *
   * Sent raw rather than as a category for the same reason `activity` is: the
   * mapping is a judgement the site makes, and it is what lets an SPZOZ be
   * recognised as a hospital at all, since those carry no PKD codes. */
  legal_form: z.string().optional(),
  /** Which organ `dzial2.organNadzoru` names, normalized upstream by
   * `scrapers/krs/organs.py` - see `Company.supervisoryOrgan`.
   *
   * Distinct from `supervisory_body` above, and the two must not be conflated:
   * that one reads the legal form and is what the site excludes an unpaid seat
   * by; this one reports what the entry actually filed, and is `"brak"` for
   * most SPZOZ.
   *
   * Snake_case here and camelCase on the node, as `is_public` and `teryt`
   * already are: the name matches the scrapers' `Company.supervisory_organ`,
   * which is the key `dataclasses.asdict` puts in the payload.
   *
   * An enum, unlike `supervisory_body` and `categories`, so a value the site
   * does not understand is a 400 rather than a string nothing can filter on.
   * That is safe only because the scrapers' normalisation is total - every
   * unrecognised organ name folds to `"inny"`. Note the failure mode until both
   * sides ship: `z.object` is not strict, so an unknown key is dropped silently
   * with a 200, exactly as `committee` was below. */
  supervisory_organ: z.enum(supervisoryOrgans).optional(),
});

export type CompanyRequest = {
  krs: string;
  name: string;
  owners?: string[];
  owner_teryts?: string[];
  owner_skarb_panstwa?: boolean;
  teryt?: string;
  activity?: string[];
  categories?: string[];
  supervisory_body?: string;
  is_public?: boolean;
  legal_form?: string;
  supervisory_organ?: SupervisoryOrgan;
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

/** The offices a candidacy can be for, as a tuple, for `z.enum`.
 *
 * `shared/misc.ts` has the same list as an array for the dropdowns to iterate;
 * zod needs a tuple of literals, and `satisfies` is what keeps the two from
 * drifting apart - a position added there and not here stops typechecking. */
const electionPositionValues = [
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
] as const satisfies readonly ElectionPosition[];

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
  election_type: z.enum(electionPositionValues),
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
  /** The node id of the page the pipeline believes this person already has.
   *
   * The site's own key, and the only identifier in this payload that cannot be
   * two people: a name is a guess and 868 people have no register link. Sent
   * only where `people_merged` matched a page without having to choose - by
   * register id, or by a name that fitted exactly one page - so the ingest may
   * take it at its word. See `lookupPersonDoc`. */
  korytaId: z.string().optional(),
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
  korytaId?: string;
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

/** A candidacy the ingest could not turn into a relation, and why.
 *
 * A candidacy hangs off the region it was fought in, and PKW does not always
 * say which one that was - it published no constituency mapping the scrapers
 * can resolve for the elections of the 1990s, and a region the payload does
 * name may still have no node on the site. Neither is a reason to reject the
 * person: the employments, the articles and the node's own fields have nothing
 * to do with it.
 *
 * So the candidacy is dropped and reported. Reported rather than merely
 * dropped, because the alternative to a 500 must not be silence - a run that
 * loses candidacies should say how many and which kind.
 */
export type UnplacedElection = {
  election_type: string;
  election_year?: string;
  /** The code the payload carried, absent when it carried none. */
  teryt?: string;
  /** `no-teryt`: the payload named no region. `no-region`: it named one the
   * site has no node for. `rejected`: the row was not usable at all - an
   * election type the site does not have, or a write that failed. */
  reason: "no-teryt" | "no-region" | "rejected";
  /** Whether this is a known gap rather than something to look into. See
   * `expectedMissingRegion` in `server/api/ingest/person.post.ts`. */
  expected: boolean;
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
  education: z.string().optional(),
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
    | "education"
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
 *
 * `categories` is here on the same terms and records `categoriesSource`. The
 * pipelines work a default out from the KRS entry, but a register code is a
 * claim about activity rather than about a sector, and the cases it gets wrong
 * are ones a reader can see and the data cannot - so the answer has to be
 * correctable from the page. Unlike the ingest payload's `categories`, this is
 * checked against the list the site offers: a proposal is typed by a person,
 * and a value off the list would file the company under a category no filter
 * can ever reach. An empty array is a legitimate answer meaning "none of
 * these", which is why the field is not `.min(1)`.
 */
export const companyEditSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana"),
  content: z.string().optional(),
  krsNumber: z.string().optional(),
  regonNumber: identifierField(normalizeRegon, isValidRegon, "REGON"),
  nipNumber: identifierField(normalizeNip, isValidNip, "NIP"),
  isPublic: z.boolean().optional(),
  categories: z
    .array(
      z.enum(companyCategoryValues, {
        message: "Nieznana kategoria",
      }),
    )
    .optional(),
}) satisfies z.ZodType<
  Pick<
    Company,
    | "name"
    | "content"
    | "krsNumber"
    | "regonNumber"
    | "nipNumber"
    | "isPublic"
    | "categories"
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

/** A date on a relation, as loosely as the register writes them.
 *
 * KRS gives a full day, PKW an election year, and a note off a press cutting
 * often only a month - so all three lengths are accepted and stored as typed.
 * The empty string is how the form clears a date that turned out to be wrong,
 * which is why this is not `.min(1)`.
 */
const relationDate = z
  .string()
  .trim()
  .refine((value) => !value || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value), {
    message: "Format daty to RRRR, RRRR-MM albo RRRR-MM-DD",
  })
  .optional();

/** Fields a person may change on an existing relation, on the same allowlist
 * terms as `personEditSchema`: anything not named here is stripped by zod, so a
 * caller cannot smuggle `published` or `revision_id` into the write.
 *
 * `source`, `target` and `type` are deliberately absent. They are what the
 * relation *is* rather than what it says - moving either end turns a wrong
 * claim into a different claim, and the honest version of that is removing this
 * relation and adding the right one, each with its own record. `references` is
 * absent for a different reason: relations are cited through
 * `/api/edges/[id]/references`, which knows how to make an article node out of
 * a bare url.
 */
export const edgeEditSchema = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  start_date: relationDate,
  end_date: relationDate,
  party: z.string().optional(),
  committee: z.string().optional(),
  position: z.enum(electionPositionValues).optional(),
  term: z.string().optional(),
  elected: z.boolean().optional(),
  by_election: z.boolean().optional(),
}) satisfies z.ZodType<
  Pick<
    Edge,
    | "name"
    | "content"
    | "start_date"
    | "end_date"
    | "party"
    | "committee"
    | "position"
    | "term"
    | "elected"
    | "by_election"
  >
>;

export type EdgeEditRequest = z.infer<typeof edgeEditSchema>;
