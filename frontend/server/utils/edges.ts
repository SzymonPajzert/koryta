import { createHash } from "node:crypto";
import type { Edge } from "~~/shared/model";

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
};

export const EDGE_SEMANTICS: Record<string, EdgeSemantics> = {
  // A company's seat, its owner, the region above it: all one per pair.
  owns: {
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
  // Not enrichable: a missing `start_date` here means "nobody knows when this
  // began", not "the pipeline had it and dropped it". Letting a dated spell
  // absorb an undated one would merge two facts that a reviewer may well have
  // entered as two, and unlike a candidacy there is no upstream loss to undo.
  employed: {
    kind: "occurrence",
    discriminators: ["name", "start_date"],
    identicalMeansSame: true,
    enrichable: false,
  },

  // A candidacy, and the one type where identical fields prove nothing. Much of
  // what would tell two apart is destroyed before the ingest sees them: the
  // office collapses into the "Samorząd" bucket (all six 2024 PKW candidate
  // files map onto it), the gmina TERYT is truncated to its powiat, and the
  // run-off round is discarded by the scraper. So standing for burmistrz and
  // for that gmina's rada in 2024 can store two identical documents, and so can
  // one mayoral bid that went to a second round.
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
  },

  // Public aid one institution paid one company under one programme, rolled up
  // from however many SUDOP decisions that was.
  //
  // The rollup is the fact, which is why `aidMeasure` is the only
  // discriminator: two grants from the same starosta under SA.116730 are two
  // rows of one report, not two ties, and storing them separately would put
  // 9461 edges where 5233 pairs exist. A second programme is a second fact,
  // because nothing about the flood measure carries over to whatever the same
  // institution pays the same company for next.
  //
  // Not enrichable, and it does not need to be: SUDOP is fed with a delay, so a
  // re-ingest of the same programme restates the same pair with a larger
  // `aidGross`, and hashing on the pair plus the measure lands it on the
  // document that is already there - where the ingest overwrites the totals
  // rather than adding to them. Enrichment is for filling in a missing
  // discriminator, and there is never one missing here: an ingest that does not
  // know the measure has no business writing the edge.
  aid: {
    kind: "occurrence",
    discriminators: ["aidMeasure"],
    identicalMeansSame: true,
    enrichable: false,
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
 * forever.
 *
 * Only meaningful for an `enrichable` type, where a blank is known to mean "not
 * known yet" rather than "there was none"; callers must check that first.
 */
export function edgeRelation(
  stored: EdgeLike,
  incoming: EdgeLike,
): EdgeRelation {
  const { discriminators } = edgeSemantics(incoming.type);

  let added = 0;
  for (const name of discriminators) {
    const before = field(stored, name);
    const after = field(incoming, name);
    if (before === null) {
      if (after !== null) added++;
      continue;
    }
    if (after !== null && JSON.stringify(before) !== JSON.stringify(after)) {
      return "conflict";
    }
  }
  return added > 0 ? "enriches" : "same";
}

/** Whether a stored edge is specific enough to be worth matching loosely. */
function meetsEnrichFloor(stored: EdgeLike): boolean {
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
    if (field(stored as EdgeLike, key) !== null) continue;
    if (field(incoming, key) === null) continue;
    // The raw value, not `field`'s: folding is for comparing, and what gets
    // stored is what PKW wrote.
    result[key] = (incoming as Record<string, unknown>)[key];
  }
  return result;
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

  for (const doc of snapshot.docs) {
    ids.add(doc.id);
    const stored = doc.data();
    if (edgeIdentity(stored as EdgeLike) === identity) {
      same.push(doc.id);
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
  return { same, enrichable, ids };
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
