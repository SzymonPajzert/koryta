import { createHash } from "node:crypto";
import type { Edge } from "~~/shared/model";

/** The two ends and the kind of tie, which every edge has. */
const EDGE_KEY_FIELDS = ["source", "target", "type"] as const;

/** The rest of what distinguishes one edge from another.
 *
 * (source, target, type) is not enough on its own, and treating it as enough is
 * a bug in both directions: a person really can hold the same post at one
 * company twice, or stand in the same region in two elections, so collapsing
 * those loses a fact — while ignoring the dates lets an ingest re-create a tie
 * it already stored.
 */
const EDGE_DETAIL_FIELDS = [
  "name",
  "start_date",
  "end_date",
  "party",
  "committee",
  "position",
  "term",
  "elected",
  "by_election",
] as const;

export const EDGE_IDENTITY_FIELDS = [
  ...EDGE_KEY_FIELDS,
  ...EDGE_DETAIL_FIELDS,
] as const;

/** Enough of an edge to say what it asserts: an `Edge`, or a stored document,
 * or the bare triple the company ingest builds. */
export type EdgeLike = Partial<Edge> & Pick<Edge, "source" | "target" | "type">;

function field(edge: EdgeLike, name: string): unknown {
  return (edge as Record<string, unknown>)[name] ?? null;
}

/** What the edge asserts, as a string two edges can be compared by.
 *
 * Absent and null read the same, so an edge written without a field matches one
 * written with it explicitly empty.
 */
export function edgeIdentity(edge: EdgeLike): string {
  return JSON.stringify(EDGE_IDENTITY_FIELDS.map((name) => field(edge, name)));
}

/** The document id an edge should be stored under.
 *
 * Deriving it from the edge means writing the same edge twice lands on one
 * document instead of two, which a lookup cannot guarantee: the ingest writes
 * through a batch, and a query does not see writes that are still in it.
 *
 * A tie with nothing but its two ends keeps the plain `edge_<source>_<target>_
 * <type>` form the company ingest has always used; anything with dates, a role
 * or an election position gets a digest of those appended, because those edges
 * may legitimately repeat between the same pair.
 */
export function edgeDocumentId(edge: EdgeLike): string {
  const base = `edge_${edge.source}_${edge.target}_${edge.type}`;
  const details = EDGE_DETAIL_FIELDS.map((name) => field(edge, name));
  if (details.every((value) => value === null)) return base;

  const digest = createHash("sha1")
    .update(edgeIdentity(edge))
    .digest("base64url")
    .slice(0, 10);
  return `${base}_${digest}`;
}

/** The id of the edge already recording exactly this, if there is one.
 *
 * Queried on the three fields every edge has — an equality-only query Firestore
 * serves from its single-field indexes, with no composite index to declare —
 * and then narrowed in memory. Comparing the rest in memory rather than in the
 * query avoids Firestore's rule that a document missing a field matches no
 * filter on it, which would make an edge stored without `start_date`
 * unfindable by a lookup that supplies one.
 */
export async function findEdge(
  db: FirebaseFirestore.Firestore,
  edge: EdgeLike,
): Promise<string | undefined> {
  const snapshot = await db
    .collection("edges")
    .where("source", "==", edge.source)
    .where("target", "==", edge.target)
    .where("type", "==", edge.type)
    .get();

  const identity = edgeIdentity(edge);
  return snapshot.docs.find(
    (doc) => edgeIdentity(doc.data() as EdgeLike) === identity,
  )?.id;
}
