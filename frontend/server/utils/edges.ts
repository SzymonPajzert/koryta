import { createHash } from "node:crypto";
import type { Edge } from "~~/shared/model";
import { electionKind, electionKindsIn } from "../../shared/electionDays";

/** What kind of assertion an edge type makes, which is what decides when two of
 * them are the same fact.
 *
 * - `state`: the tie either holds or it does not. An article names a person; a
 *   region owns a company. There is nothing to count, so a second copy asserts
 *   nothing new and is always redundant.
 * - `occurrence`: one bounded episode, and a person can genuinely have several
 *   between the same pair - two spells at one company with a break in between,
 *   two candidacies in one region. Two of them are the same episode only when
 *   the fields that pin the episode down are present and equal.
 * - `authored`: something a person wrote. Two notes about the same pair are two
 *   notes. Never merged automatically, whatever the fields say.
 */
export type EdgeKind = "state" | "occurrence" | "authored";

type EdgeSemantics = {
  kind: EdgeKind;
  /** Fields beyond the pair that say *which* episode this is. Empty for state
   * types, where the pair is the whole assertion. */
  discriminators: readonly string[];
  /** Whether two stored edges agreeing on all of the above may be treated as
   * one fact by a migration. False where the pipeline is known to destroy the
   * difference between two real facts, so "identical" proves nothing. */
  identicalMeansSame: boolean;
  /** Whether a stored edge of this type may be *enriched*: matched by an
   * incoming edge that contradicts nothing it says and fills in a
   * discriminator it does not have, rather than stored beside it as a second
   * fact. See `enriches`. */
  enrichable: boolean;
  /** Fields that say something *about* the episode without saying which
   * episode it is.
   *
   * They take part in enrichment - filling one in is a reason to write, and
   * disagreeing about one is a conflict - but never in identity, so learning
   * one cannot move an edge to a different document id. `elected` is the case
   * this exists for: the outcome of a candidacy is worth storing and worth
   * refusing to overwrite, but two candidacies are not made different episodes
   * by one of them having won. Putting it in `discriminators` would hash every
   * winning candidacy to a new id and store it a second time. */
  annotations?: readonly string[];
};

export const EDGE_SEMANTICS: Record<string, EdgeSemantics> = {
  // An owner, and the region above a region: one per pair.
  owns: {
    kind: "state",
    discriminators: [],
    identicalMeansSame: true,
    enrichable: false,
  },
  // Where a company is registered. One per pair, and in fact one per company -
  // a company has a single registered seat.
  seat: {
    kind: "state",
    discriminators: [],
    identicalMeansSame: true,
    enrichable: false,
  },
  // An article names a person or a company. Naming them twice is one fact.
  mentions: {
    kind: "state",
    discriminators: [],
    identicalMeansSame: true,
    enrichable: false,
  },
  // A pointer to a document in the `comments` collection, which holds the text.
  comment: {
    kind: "state",
    discriminators: [],
    identicalMeansSame: true,
    enrichable: false,
  },
  // Undeclared in shared/model.ts, but 64 are stored: bare triples that predate
  // article nodes.
  source: {
    kind: "state",
    discriminators: [],
    identicalMeansSame: true,
    enrichable: false,
  },

  // A spell of employment, pinned by the role and when it began. `end_date` is
  // not a discriminator: it is learned later, so one spell recorded twice -
  // once still open, once since closed - is one episode. Two real spells always
  // differ in `start_date`, which is what "employed there again after a break"
  // means.
  //
  // Learned later is also why it is an annotation: a spell stored while it was
  // held learns its end from the first payload that has one. Without that a
  // job stayed current on the site for good once stored, whatever the register
  // said since - see `fillAnnotations` in the person ingest.
  //
  // Not enrichable: a missing `start_date` here means "nobody knows when this
  // began", not "the pipeline had it and dropped it". Letting a dated spell
  // absorb an undated one would merge two facts that a reviewer may well have
  // entered as two, and unlike a candidacy there is no upstream loss to undo.
  employed: {
    kind: "occurrence",
    discriminators: ["name", "start_date"],
    identicalMeansSame: true,
    enrichable: false,
    annotations: ["end_date"],
  },

  // A candidacy, and the one type where identical fields prove nothing. Much of
  // what would tell two apart was destroyed before the ingest saw them: the
  // office collapsed into the "Samorząd" bucket, the gmina TERYT is truncated
  // to its powiat, and the run-off round was a row of its own. So standing for
  // burmistrz and for that gmina's rada stored two identical documents, and so
  // could one mayoral bid that went to a second round. The pipeline now names
  // the office where PKW's files say it (`scrapers/pkw/offices.py`), but every
  // candidacy stored before that still says "Samorząd".
  //
  // `committee` is now accepted and stored, which separates two candidacies run
  // under different committees - but every stored candidacy predates that, and
  // two bids under the same committee still look alike. So this stays false:
  // equal fields are not evidence of one fact here, and a migration may not
  // merge on them.
  //
  // It is, however, the one type worth enriching. All 10476 stored candidacies
  // were written before the ingest accepted a committee, so every one of them
  // is the *same* fact the pipeline is about to restate, only with less on it.
  // Without this the restatement hashes to a different document id and lands
  // beside the original as a duplicate.
  election: {
    kind: "occurrence",
    discriminators: ["position", "start_date", "party", "committee", "term"],
    identicalMeansSame: false,
    enrichable: true,
    annotations: ["elected"],
  },

  // Written by hand through /api/edges/create, never by an ingest.
  connection: {
    kind: "authored",
    discriminators: ["name", "content", "start_date", "end_date"],
    identicalMeansSame: false,
    enrichable: false,
  },
};

/** What an unknown edge type is assumed to be.
 *
 * `authored` on purpose: it is the reading under which nothing is merged
 * automatically, so a type nobody has classified yet cannot lose data.
 */
const UNKNOWN: EdgeSemantics = {
  kind: "authored",
  discriminators: ["name", "content", "start_date", "end_date"],
  identicalMeansSame: false,
  enrichable: false,
};

export function edgeSemantics(type: string | undefined) {
  return (type && EDGE_SEMANTICS[type]) || UNKNOWN;
}

export type EdgeLike = Partial<Edge> & Pick<Edge, "source" | "target" | "type">;

/** Fields whose stored spelling varies without the fact varying.
 *
 * `committee` is the only one. PKW writes the same committee differently from
 * file to file - the full name in one year's tables, the abbreviation in
 * another's, uppercase here and title case there, with whatever spacing the
 * spreadsheet had; `scrapers/pkw/elections.py` keeps both
 * "komitet wyborczy prawo i sprawiedliwość" and "kw prawo i sprawiedliwość" as
 * separate keys for exactly that reason, and only casefolds for its own lookup
 * - what it stores is the raw cell.
 *
 * Comparing those raw would make one re-scrape in a different case a second
 * candidacy: no exact match, and no enrichment either, since a stored committee
 * that disagrees is not a stored committee that is missing. Two genuinely
 * different committees never differ only in case and spacing, so folding both
 * away costs nothing and is what keeps the collection from growing on a
 * spelling.
 */
const FOLDED_FIELDS = new Set(["committee"]);

/** Why `elected: false` is still read as a blank, below.
 *
 * "Stood and did not take the seat" would be worth recording, and reading it
 * as "nobody said" makes it unstorable. It is read that way anyway, because
 * nothing in this codebase asserts it: the ingest sends a win and never a
 * defeat (see `elected` in shared/api.ts), and all 15 of the stored `false`
 * values are checkboxes a contributor left unticked, not defeats anybody
 * entered. Treating those 15 as recorded losses would freeze them - an
 * incoming win would be a conflict rather than an enrichment - which is
 * exactly the backfill this annotation exists for, blocked on the people it
 * would be most wrong about.
 *
 * Neither `/api/edges/create` nor `/api/edges/update` writes one any more, so
 * the set cannot grow. Whatever starts meaning "lost" is what should make
 * `false` an answer here. */

/** One writer's "unset" has to equal another's.
 *
 * /api/edges/create writes `name: ""`, `party: ""` and `elected: false` for
 * every field the form left blank, while the ingest omits them entirely. Left
 * alone a hand-made edge could never match an ingested one asserting the same
 * thing, and the database would keep both.
 */
function field(edge: EdgeLike, name: string): unknown {
  const value = (edge as Record<string, unknown>)[name];
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false
  ) {
    return null;
  }
  if (FOLDED_FIELDS.has(name) && typeof value === "string") {
    return value.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  }
  return value;
}

/** What the edge asserts, as a string two edges can be compared by.
 *
 * Type-aware: for a state edge the pair is the whole of it, so an `owns` edge
 * that picked up a stray date still asserts the same tie. For an occurrence
 * edge the discriminators are part of the assertion, so two spells starting on
 * different days are two facts.
 */
export function edgeIdentity(edge: EdgeLike): string {
  const { discriminators } = edgeSemantics(edge.type);
  return JSON.stringify([
    edge.source,
    edge.target,
    edge.type,
    ...discriminators.map((name) => field(edge, name)),
  ]);
}

/** The document id an edge should be stored under.
 *
 * Deriving it from the identity means writing the same edge twice lands on one
 * document rather than two, which a lookup cannot guarantee: the ingest writes
 * through a batch, and a query does not see writes still sitting in it.
 *
 * `occurrence` says which copy this is among the ones a payload asserts with
 * the same identity. It exists because an occurrence edge may legitimately
 * repeat with nothing to tell the copies apart - a payload listing two 2024
 * candidacies in one powiat states two facts, and both have to be stored. Copy
 * 0 keeps the plain digest, so the ordinary case is unchanged.
 *
 * State edges ignore it: they cannot repeat, so they always get the bare
 * `edge_<source>_<target>_<type>` form the company ingest and the region
 * pipeline already write.
 */
export function edgeDocumentId(edge: EdgeLike, occurrence = 0): string {
  const base = `edge_${edge.source}_${edge.target}_${edge.type}`;
  const { kind, discriminators } = edgeSemantics(edge.type);
  if (kind === "state") return base;

  const parts: unknown[] = discriminators.map((name) => field(edge, name));
  if (occurrence > 0) parts.push(occurrence);
  if (parts.every((value) => value === null)) return base;

  const digest = createHash("sha1")
    .update(JSON.stringify(parts))
    .digest("base64url")
    .slice(0, 10);
  return `${base}_${digest}`;
}

/** What a stored edge must already say before it can be enriched at all.
 *
 * `enriches` asks that nothing contradicts and that something is added, and on
 * its own that is not enough: an edge that says nothing contradicts nothing, so
 * a blank one would absorb the first candidacy the pipeline offered. And blank
 * ones exist - `/api/edges/create` writes `position: ""`, `start_date: null`
 * and `committee: ""` for every box the form left empty, so a moderator noting
 * "stood here, check which year" leaves an edge with no discriminator at all.
 *
 * The floor is the same judgement `dedupe-edges.ts` already makes about
 * collapsing: agreeing on nothing is not evidence of being the same episode.
 * For a candidacy the year is what makes it one - and all 10476 stored
 * candidacies have `start_date`, so nothing real is excluded by asking for it.
 */
const ENRICH_FLOOR: Record<string, readonly string[]> = {
  election: ["start_date"],
};

export type EdgeRelation = "conflict" | "same" | "enriches";

/** The office of a local candidacy nothing named: "one of the local offices".
 *
 * What the pipeline called every local candidacy until it carried the office
 * out of PKW's files, and what it still sends where the files do not say (see
 * the `election` entry above) - so it is what nearly every stored local
 * candidacy says. */
const UNNAMED_LOCAL_OFFICE = "Samorząd";

/** The offices a local election fills - everything in `electionPositions`
 * but the unnamed one and the three national ones. Mirrored as
 * `LOCAL_OFFICES` in `data/pipelines/src/analysis/payloads/site.py`.
 *
 * „Prezydent" here is a city's prezydent, which is where the site's list puts
 * it. The pipeline maps a national presidential election to the same string
 * (`get_election_type` in analysis/payloads/election.py), but no scraper
 * produces one and none is stored; if that changes, a presidential candidacy
 * stored as „Prezydent" would pass here for a local one. */
const LOCAL_OFFICES: ReadonlySet<string> = new Set([
  "Sejmik",
  "Rada miasta",
  "Rada gminy",
  "Rada powiatu",
  "Rada dzielnicy",
  "Burmistrz",
  "Wójt",
  "Prezydent",
]);

/** Whether an office is one of the named local ones, rather than „Samorząd”
 * or a national office. */
export function isLocalOffice(position: unknown): position is string {
  return typeof position === "string" && LOCAL_OFFICES.has(position);
}

/** Whether a stored value says what the incoming one says, only more
 * precisely.
 *
 * The office is the one field with such a pair. The relation dialogs let a
 * reader say which council a „Samorząd" candidacy was for, and a candidacy
 * narrowed down to „Rada gminy" still asserts everything the pipeline's row
 * does. Read as a disagreement, the next run would store that row beside it as
 * a second candidacy - putting back, as a duplicate, the vague row the
 * correction replaced. The other way round - a named office arriving for a
 * stored „Samorząd" - is `specifies`, and a national office is never a local
 * one. */
function narrows(name: string, stored: unknown, incoming: unknown): boolean {
  return specifies(name, incoming, stored);
}

/** Whether the incoming value names the office a stored candidacy only says
 * was local: the other half of `narrows`.
 *
 * The pipeline names the office now, and the 12,941 local candidacies stored
 * before it did say „Samorząd". Read as a disagreement, every one would be
 * written a second time beside itself, named; read as the same fact, none
 * would ever learn its name. It is filling in a blank - the blank this word
 * stands for - so it enriches, and `enrichedEdge` writes the office over the
 * word. Never the other way round, and a national office is never a local
 * one. */
function specifies(name: string, stored: unknown, incoming: unknown): boolean {
  return (
    name === "position" &&
    stored === UNNAMED_LOCAL_OFFICE &&
    typeof incoming === "string" &&
    LOCAL_OFFICES.has(incoming)
  );
}

/** How `incoming` stands to a stored edge of the same pair and type.
 *
 * This is what lets a pipeline that has started sending a field update the
 * 10476 candidacies stored before it did, instead of writing every one of them
 * a second time under a different document id.
 *
 * - `conflict`: they disagree about a discriminator they both know. A stored
 *   Sejm candidacy is not a fresh Samorząd one however much else lines up.
 * - `enriches`: no disagreement, and the incoming edge fills in at least one
 *   discriminator the stored edge lacks.
 * - `same`: no disagreement and nothing to add. The stored edge already says
 *   everything the payload says, and may say more.
 *
 * The asymmetry in "no disagreement" is deliberate: where only the *stored*
 * edge knows a discriminator - a `term` a reviewer typed in, which the scrapers
 * never send - that is not a disagreement, because the pipeline saying nothing
 * is not the pipeline saying "none". Reading it as one would make every
 * hand-corrected edge permanently un-matchable, and an un-matchable edge is not
 * left alone: the caller creates a second document beside it, every run,
 * forever. The office a reviewer has narrowed down is the same case, one step
 * removed - the pipeline does send one, but "Samorząd" says less than the
 * stored office rather than something else; see `narrows`.
 *
 * Only meaningful for an `enrichable` type, where a blank is known to mean "not
 * known yet" rather than "there was none"; callers must check that first.
 */
export function edgeRelation(
  stored: EdgeLike,
  incoming: EdgeLike,
): EdgeRelation {
  const { discriminators, annotations } = edgeSemantics(incoming.type);

  let added = 0;
  for (const name of [...discriminators, ...(annotations ?? [])]) {
    const before = field(stored, name);
    const after = field(incoming, name);
    if (before === null) {
      if (after !== null) added++;
      continue;
    }
    if (after !== null && JSON.stringify(before) !== JSON.stringify(after)) {
      if (narrows(name, before, after)) continue;
      if (specifies(name, before, after)) {
        added++;
        continue;
      }
      return "conflict";
    }
  }
  return added > 0 ? "enriches" : "same";
}

/** Whether a stored edge is specific enough to be worth matching loosely. */
export function meetsEnrichFloor(stored: EdgeLike): boolean {
  const required = ENRICH_FLOOR[String(stored.type)] ?? [];
  return required.every((name) => field(stored, name) !== null);
}

/** The stored edge with what the payload knows and it does not, and nothing
 * else touched.
 *
 * Filling blanks rather than merging is what keeps an enrichment from being an
 * overwrite. The ingest restates fields it does not really have an opinion
 * about - `createElection` sends `name: "kandydatura"` on every candidacy -
 * so a plain `{...stored, ...incoming}` would silently reset a label a reviewer
 * had rewritten. Anything the stored edge already says, it keeps; anything it
 * disagrees about never gets here, because that is a `conflict`.
 */
export function enrichedEdge(
  stored: Record<string, unknown>,
  incoming: EdgeLike,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...stored };
  for (const key of Object.keys(incoming)) {
    const value = (incoming as Record<string, unknown>)[key];
    // „Samorząd" stands for a blank, and a named office fills it.
    if (specifies(key, stored[key], value)) {
      result[key] = value;
      continue;
    }
    if (field(stored as EdgeLike, key) !== null) continue;
    if (field(incoming, key) === null) continue;
    // The raw value, not `field`'s: folding is for comparing, and what gets
    // stored is what PKW wrote.
    result[key] = (incoming as Record<string, unknown>)[key];
  }
  return result;
}

/** Whether everything the payload would add to this edge is an annotation.
 *
 * The question a caller asks before writing an enrichment out rather than
 * proposing it. A candidacy's committee is proposed because recognising it is
 * a judgement; its result is not a judgement at all - PKW publishes who took
 * the mandate, and the payload carries that column and nothing else. But the
 * two ride in one revision: `enrichedEdge` fills every blank it can, so
 * vouching for a revision because it carries a result would write an
 * unrecognised committee out on the back of it, which is the review the
 * committee rule exists for.
 *
 * So it is the whole set that has to be annotations, not merely one of them.
 */
export function addsOnlyAnnotations(
  /** The stored document, as `enrichedEdge` takes it - straight off Firestore,
   * so typed as the map it is rather than as an `Edge`. */
  stored: Record<string, unknown>,
  incoming: EdgeLike,
): boolean {
  const { discriminators, annotations } = edgeSemantics(incoming.type);
  if (!annotations?.length) return false;

  const adds = (name: string) =>
    field(stored as EdgeLike, name) === null && field(incoming, name) !== null;
  return annotations.some(adds) && !discriminators.some(adds);
}

/** Whether the incoming office says which seat a stored candidacy was for,
 * where the stored copy leaves that open: a „Samorząd” copy given a local
 * office (`specifies`), or a copy with no office at all in a year that held
 * no other kind of election than the incoming one (`isSameRun`).
 *
 * Either way it is what PKW's files say about this run rather than anybody's
 * judgement, as the result is. A copy with no office in 2014, 2019 or 2024 is
 * not named this way: those years held two kinds of election, and the copy
 * may be the other one's. 1,544 live candidacies had no office on the
 * 2026-10-17 export, Hubert Papaj's 2018 and 2024 mayoral runs among them. */
export function namesOffice(stored: EdgeLike, incoming: EdgeLike): boolean {
  if (incoming.type !== "election") return false;
  if (specifies("position", stored.position, incoming.position)) return true;
  return field(stored, "position") === null && isSameRun(stored, incoming);
}

/** Whether everything the payload would add to this edge is a fact PKW records
 * outright, which needs no reviewer: an annotation, or which office the
 * candidacy was for (`namesOffice`).
 *
 * The office is the same kind of fact as the result: PKW's files say which
 * seat each candidate stood for, and `scrapers/pkw/offices.py` reads it off
 * them rather than judging anything - unlike a committee, which is proposed
 * because recognising one is a judgement. Where the payload brings one of
 * those as well, the recorded facts go out on their own (`withRecordedFacts`)
 * and the rest waits for a reviewer.
 */
export function addsOnlyRecordedFacts(
  stored: Record<string, unknown>,
  incoming: EdgeLike,
): boolean {
  const { discriminators, annotations = [] } = edgeSemantics(incoming.type);
  const office = namesOffice(stored as EdgeLike, incoming);
  const adds = (name: string) =>
    field(stored as EdgeLike, name) === null && field(incoming, name) !== null;
  // The office filling in a copy that has none is the one discriminator PKW
  // records outright; any other one added is a judgement.
  const judged = (name: string) =>
    adds(name) && !(name === "position" && office);
  return (annotations.some(adds) || office) && !discriminators.some(judged);
}

/** The stored edge with what PKW records outright written in and nothing else:
 * the office where `namesOffice` says it, and each annotation the edge lacks.
 * Undefined when the payload brings no such fact.
 *
 * What goes out without a reviewer when the payload also brings something
 * that needs one. They used to wait together: a „Samorząd” candidacy whose row
 * named its office and an unrecognised committee was proposed whole, and the
 * page said „Samorząd” until somebody approved the committee - 178 published
 * runs on the 2026-10-15 plan, and all eight of Robert Marek Starzyński's on
 * the „Wyślij dane” of 2026-10-24, every one a local KWW. Which seat he stood
 * for, and whether he took it, is not what a reviewer was being asked.
 */
export function withRecordedFacts(
  stored: Record<string, unknown>,
  incoming: EdgeLike,
): Record<string, unknown> | undefined {
  const { annotations = [] } = edgeSemantics(incoming.type);
  const result: Record<string, unknown> = { ...stored };
  let added = false;
  if (namesOffice(stored as EdgeLike, incoming)) {
    result.position = incoming.position;
    added = true;
  }
  for (const name of annotations) {
    if (
      field(stored as EdgeLike, name) === null &&
      field(incoming, name) !== null
    ) {
      result[name] = (incoming as Record<string, unknown>)[name];
      added = true;
    }
  }
  return added ? result : undefined;
}

/** The offices a whole district elects: the Sejm, the Senate and the European
 * Parliament. The pipeline files each such run under the województwo its
 * district lies in (the seat's, for a European district spanning two), never
 * under a powiat or a gmina. */
const DISTRICT_OFFICES: ReadonlySet<string> = new Set([
  "Sejm",
  "Senat",
  "Parlament Europejski",
]);

/** Whether a candidacy's office is one a whole district elects. */
export function isDistrictOffice(
  position: unknown,
): position is "Sejm" | "Senat" | "Parlament Europejski" {
  return typeof position === "string" && DISTRICT_OFFICES.has(position);
}

/** Whether a stored candidacy is a copy of the run `incoming` states, as far as
 * the year and the office tell: the same office in the same year, or no office
 * at all in a year that held no other kind of election than that one.
 *
 * 1,549 live candidacies had no office on the 2026-10-15 export: uploads from
 * before the ingest wrote one, and hand-made ones whose form left it empty. A
 * 2023 one of those can only be a parliamentary run, because 2023 held
 * nothing else; a 2019 one could be the Sejm's or the European Parliament's,
 * and is not taken for either (`electionKindsIn`). Nobody stands for the Sejm
 * and the Senate in one election, so a parliamentary year's office-less copy is
 * whichever of the two the payload says. */
export function isSameRun(stored: EdgeLike, incoming: EdgeLike): boolean {
  if (!incoming.start_date || stored.start_date !== incoming.start_date) {
    return false;
  }
  const office = field(stored, "position");
  if (office !== null) return office === incoming.position;
  const kind = electionKind(incoming.position);
  const held = electionKindsIn(String(incoming.start_date).slice(0, 4));
  return kind !== null && held.length === 1 && held[0] === kind;
}

/** Whether `stored`, filed under the region coded `storedTeryt`, is the run
 * `incoming` places under its district's województwo (`districtTeryt`), filed
 * under the candidate's home instead.
 *
 * Every upload before 2026-07-30 could file a run under the place PKW's list
 * gives as the candidate's home: the merge kept that code and the district's in
 * one list that did not keep its order, and everything took the first of them
 * (df49f43e, "File a candidacy where it was run, not where the candidate
 * lives"). The pipeline has filed the run under its district since, and the
 * ingest, which looks for a stored candidacy under the payload's region only,
 * could not see the copy at home - so it stored the run a second time beside
 * it. 168 runs were stored twice that way on the 2026-10-23 export, and Michał
 * Jerzy Sobczak's 2023 Sejm run, live under Łódź beside a draft under
 * łódzkie, is how it was noticed.
 *
 * - The office is one a whole district elects, and the copy is that run
 *   (`isSameRun`).
 * - The copy is filed below a województwo. One under a województwo is where
 *   its district is.
 * - For the Sejm and the Senate, the copy's place lies inside the district's
 *   województwo, as a district does. A copy anywhere else could as well be the
 *   run of a namesake whose PKW record was joined to the person's, and a page
 *   standing in two województwa in one election is for a reviewer to look at
 *   (`shared/twoPlaces.ts`). A European district is one or two whole
 *   województwa and is filed under its seat's, so a European run is taken from
 *   any home, as it always was.
 * - Nothing about the two disagrees (`edgeRelation`): a committee or a party
 *   that differs is somebody else's run. And a removed copy stays as its
 *   reviewer left it.
 *
 * Shared by the ingest, which moves such a copy to the district instead of
 * storing the run again (`moveMisfiledCandidacy` in
 * server/api/ingest/person.post.ts), and by
 * scripts/migrate/archive/merge-national-runs-stored-twice.ts, which folds together the
 * runs stored twice before it did. `_misfiled_candidacy` in
 * data/pipelines/src/analysis/payloads/site.py is the planner's copy. */
export function misfiledRunOf(
  stored: EdgeLike,
  storedTeryt: unknown,
  incoming: EdgeLike,
  districtTeryt: unknown,
): boolean {
  const office = incoming.position;
  if (!isDistrictOffice(office)) return false;
  if ((stored as { deleted?: unknown }).deleted === true) return false;
  if (!isSameRun(stored, incoming)) return false;
  if (typeof storedTeryt !== "string" || storedTeryt.length <= 2) return false;
  if (
    office !== "Parlament Europejski" &&
    (typeof districtTeryt !== "string" ||
      !storedTeryt.startsWith(districtTeryt))
  ) {
    return false;
  }
  return edgeRelation(stored, incoming) !== "conflict";
}

/** Whether a stored candidacy says no more than that it was local: „Samorząd”,
 * or no office at all in a year that held only local elections (2014 and 2024
 * held the European one as well). */
export function unnamedLocal(stored: EdgeLike): boolean {
  const office = field(stored, "position");
  if (office !== null) return office === UNNAMED_LOCAL_OFFICE;
  const held = electionKindsIn(String(stored.start_date ?? "").slice(0, 4));
  return held.length === 1 && held[0] === "local";
}

/** Whether `stored`, filed under `storedTeryt`, is the sejmik run `incoming`
 * places under its województwo (`districtTeryt`), stored without its office
 * under the candidate's home instead.
 *
 * The same upload bug as `misfiledRunOf`'s, met by a local run: the sejmik is
 * elected by a whole województwo, and the uploads before 2026-07-30 could file
 * the run under the candidate's home, as „Samorząd”. But „Samorząd” there says
 * only that the run was local, and a council or mayoral run in that town is
 * local too - so this is only the sejmik run where the payload has no other
 * local run that year, which the caller has to check: a person stands for one
 * council at a time, and the sejmik is one. Michał Jerzy Sobczak's 2024 run is
 * such a copy, live under Łódź beside the draft „Sejmik” under łódzkie.
 *
 * Otherwise as `misfiledRunOf`: same date, below the województwo and inside
 * it, nothing disagreeing, not removed. */
export function misfiledSejmikRunOf(
  stored: EdgeLike,
  storedTeryt: unknown,
  incoming: EdgeLike,
  districtTeryt: unknown,
): boolean {
  if (incoming.position !== "Sejmik") return false;
  if ((stored as { deleted?: unknown }).deleted === true) return false;
  if (!incoming.start_date || stored.start_date !== incoming.start_date) {
    return false;
  }
  if (!unnamedLocal(stored)) return false;
  if (typeof storedTeryt !== "string" || storedTeryt.length <= 2) return false;
  if (
    typeof districtTeryt !== "string" ||
    !storedTeryt.startsWith(districtTeryt)
  ) {
    return false;
  }
  return edgeRelation(stored, incoming) !== "conflict";
}

/** A stored edge one payload row could be placed onto, and how the row stands
 * to it (`edgeRelation`). */
export type EdgeCopy = {
  id: string;
  stored: Record<string, unknown>;
  relation: Exclude<EdgeRelation, "conflict">;
};

/** Which of the stored copies a row of an enrichable type should take.
 *
 * Several copies can fit one row: the pipeline strips the office from a local
 * candidacy, so a council run and a mayoral run in one town in one year arrive
 * as two rows that differ only in whether they won, and are stored as two
 * copies that differ the same way. Taking them in order of id - the rule while
 * every copy of a row looked alike - paired each row with whichever copy came
 * first. Marcin Witko's 2010 pair, a council seat he won and a mayoral race he
 * lost, would have had the win written onto the copy for the race he lost by
 * the next send, or stored a third time had the two ids sorted the other way.
 *
 * So the copy that is this row's own goes first:
 * - one asserting exactly what the row does, before one the row could only
 *   enrich or that says more than it - which is what keeps an identical
 *   restatement on a removed edge rather than beside it;
 * - then one that agrees with the row about its annotations, a win with a win
 *   and a blank with a blank, since an annotation is the one thing two such
 *   copies still differ in;
 * - then a live copy before a removed one, then one that needs no write, then
 *   by id, so a dry run predicts the real one.
 *
 * This only settles who goes with whom among rows that compete for the same
 * copies if the rows that say more come first - a blank row fits a won copy,
 * and taking it would leave the won row nothing - which is why the ingest
 * places the candidacies that carry a result before the rest.
 */
export function preferredCopy<C extends EdgeCopy>(
  edge: EdgeLike,
  copies: readonly C[],
): C | undefined {
  const identity = edgeIdentity(edge);
  const annotations = edgeSemantics(edge.type).annotations ?? [];
  const rank = (copy: C): number[] => [
    edgeIdentity(copy.stored as EdgeLike) === identity ? 0 : 1,
    annotations.filter(
      (name) =>
        JSON.stringify(field(copy.stored as EdgeLike, name)) !==
        JSON.stringify(field(edge, name)),
    ).length,
    copy.stored.deleted === true ? 1 : 0,
    copy.relation === "same" ? 0 : 1,
  ];
  let best: { copy: C; rank: number[] } | undefined;
  for (const copy of copies) {
    const current = { copy, rank: rank(copy) };
    if (!best || precedes(current, best)) best = current;
  }
  return best?.copy;
}

function precedes(
  a: { copy: EdgeCopy; rank: number[] },
  b: { copy: EdgeCopy; rank: number[] },
): boolean {
  for (let i = 0; i < a.rank.length; i++) {
    if (a.rank[i] !== b.rank[i]) return a.rank[i]! < b.rank[i]!;
  }
  return a.copy.id < b.copy.id;
}

/** How every stored edge between this pair relates to `edge`.
 *
 * One query, partitioned in memory, because the answers all come from the same
 * documents and an ingest that asked twice would double its reads.
 *
 * `same` is exact identity for a type that cannot be enriched, and the looser
 * `edgeRelation` reading for one that can - so a candidacy a reviewer has added
 * a `term` to still counts as already saying what the payload says, rather than
 * being restated as a second document.
 *
 * `enrichable` carries the stored document, not just its id: the caller has to
 * fill its blanks to build the revision, and re-reading it would be a second
 * round trip against a collection this request has pending writes for.
 * `documents` has every sibling's, for the same reason: an exact match of a
 * type that is not enrichable is in `same`, and can still learn an annotation.
 *
 * `ids` is every sibling, which the caller needs to avoid creating a new edge
 * on top of one of them - see `edgeDocumentId`.
 */
export async function findEdgeMatches(
  db: FirebaseFirestore.Firestore,
  edge: EdgeLike,
): Promise<{
  same: string[];
  enrichable: { id: string; stored: Record<string, unknown> }[];
  ids: Set<string>;
  documents: Map<string, Record<string, unknown>>;
}> {
  const snapshot = await db
    .collection("edges")
    .where("source", "==", edge.source)
    .where("target", "==", edge.target)
    .where("type", "==", edge.type)
    .get();

  const identity = edgeIdentity(edge);
  const { enrichable: mayEnrich } = edgeSemantics(edge.type);
  const same: string[] = [];
  const enrichable: { id: string; stored: Record<string, unknown> }[] = [];
  const ids = new Set<string>();
  const documents = new Map<string, Record<string, unknown>>();

  for (const doc of snapshot.docs) {
    ids.add(doc.id);
    const stored = doc.data();
    documents.set(doc.id, stored);
    if (edgeIdentity(stored as EdgeLike) === identity) {
      // The same episode, by every field that says which episode it is. It can
      // still be missing an annotation the payload carries - whether the
      // candidacy took the seat - and that is a reason to write even though
      // nothing about *which* candidacy it is has changed. A disagreement
      // about one is not: the stored answer is either a reviewer's or an
      // earlier run's, and `enrichedEdge` fills blanks rather than
      // overwriting, so there is nothing there for the payload to do.
      const relation = mayEnrich
        ? edgeRelation(stored as EdgeLike, edge)
        : "same";
      if (relation === "enriches") enrichable.push({ id: doc.id, stored });
      else same.push(doc.id);
      continue;
    }
    if (!mayEnrich || !meetsEnrichFloor(stored as EdgeLike)) continue;

    switch (edgeRelation(stored as EdgeLike, edge)) {
      case "enriches":
        enrichable.push({ id: doc.id, stored });
        break;
      case "same":
        same.push(doc.id);
        break;
      case "conflict":
        break;
    }
  }

  // Sorted so a dry run predicts the real one and a re-run picks the same
  // document again: which of several indistinguishable candidacies gets which
  // committee is arbitrary, but it must not be arbitrary *differently* twice.
  same.sort();
  enrichable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { same, enrichable, ids, documents };
}

/** Every stored edge asserting the same thing as `edge`, by id.
 *
 * A list rather than one match, because an occurrence edge may legitimately
 * have several. The caller takes the n-th when it is placing the n-th copy from
 * a payload, which is what stops re-ingesting that payload growing the
 * collection while still letting it hold two.
 *
 * Queried on the three fields every edge has - an equality-only query Firestore
 * serves from its single field indexes, with no composite index to declare -
 * and narrowed in memory. Comparing the discriminators in memory rather than in
 * the query avoids Firestore's rule that a document missing a field matches no
 * filter on it, which would make an edge stored without `start_date`
 * unfindable by a lookup that supplies one.
 */
export async function findEdges(
  db: FirebaseFirestore.Firestore,
  edge: EdgeLike,
): Promise<string[]> {
  const snapshot = await db
    .collection("edges")
    .where("source", "==", edge.source)
    .where("target", "==", edge.target)
    .where("type", "==", edge.type)
    .get();

  const identity = edgeIdentity(edge);
  return snapshot.docs
    .filter((doc) => edgeIdentity(doc.data() as EdgeLike) === identity)
    .map((doc) => doc.id)
    .sort();
}

/** The edge already asserting this, if there is one. */
export async function findEdge(
  db: FirebaseFirestore.Firestore,
  edge: EdgeLike,
): Promise<string | undefined> {
  return (await findEdges(db, edge))[0];
}
