import type {
  Firestore,
  DocumentReference,
  WriteBatch,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Edge, Revision } from "~~/shared/model";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import { recordAudit } from "~~/server/utils/audit";
import { holdsRevision } from "~~/server/utils/revisions";

/** What an edge needs before it can be shown to the public.
 *
 * An edge is a claim about two pages, so publishing it publishes a statement
 * about both. Where one of them is still a draft the claim points at a page
 * nobody can open, which is why `publishable` is the conjunction rather than
 * the edge's own state alone.
 */
export interface EdgeEndpoints {
  id: string;
  source: string;
  target: string;
  sourceName: string | null;
  targetName: string | null;
  sourcePublished: boolean;
  targetPublished: boolean;
  /** Whether both ends are live, and so whether this edge may be published. */
  publishable: boolean;
  /** The end that is holding it back, for a message that says which. */
  blockedBy: { id: string; name: string | null }[];
}

/** The state of every node an edge in `edges` touches, in one round trip per
 * 100 ids.
 *
 * Firestore has no join, so the endpoints have to be read separately whatever
 * we do; what it does have is `getAll`, which the node fetch path already
 * chunks at 100 (see `fetchNodesByIds`). Resolving the whole batch at once is
 * what keeps the admin views off an N+1.
 */
export async function resolveEdgeEndpoints(
  db: Firestore,
  edges: Pick<Edge, "id" | "source" | "target">[],
): Promise<Map<string, EdgeEndpoints>> {
  const nodeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source) nodeIds.add(edge.source);
    if (edge.target) nodeIds.add(edge.target);
  }

  const nodes = new Map<string, { name: string | null; published: boolean }>();
  const ids = Array.from(nodeIds);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const refs = chunk.map((id) => db.collection("nodes").doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const data = snap.data();
      nodes.set(snap.id, {
        name: typeof data?.name === "string" ? data.name : null,
        // A node that was never created is not published, which is the answer
        // that keeps a dangling edge out of the public graph.
        published: snap.exists ? pageIsPublic(data ?? {}) : false,
      });
    }
  }

  const result = new Map<string, EdgeEndpoints>();
  for (const edge of edges) {
    if (!edge.id) continue;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const sourcePublished = source?.published === true;
    const targetPublished = target?.published === true;
    const blockedBy: { id: string; name: string | null }[] = [];
    if (!sourcePublished) {
      blockedBy.push({ id: edge.source, name: source?.name ?? null });
    }
    if (!targetPublished && edge.target !== edge.source) {
      blockedBy.push({ id: edge.target, name: target?.name ?? null });
    }

    result.set(edge.id, {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceName: source?.name ?? null,
      targetName: target?.name ?? null,
      sourcePublished,
      targetPublished,
      publishable: sourcePublished && targetPublished,
      blockedBy,
    });
  }
  return result;
}

/** Every revision written against `edgeId`, newest first.
 *
 * Edge revisions carry the edge's id in `node_id` - the field is named after
 * the collection it was invented for, not after what it holds - so this is the
 * same query the node review page runs, pointed at the other collection.
 */
export async function edgeRevisions(
  db: Firestore,
  edgeId: string,
): Promise<(Revision & { id: string })[]> {
  const snap = await db
    .collection("revisions")
    .where("node_id", "==", edgeId)
    .get();

  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Revision) }))
    .sort((a, b) => revisionTime(b) - revisionTime(a));
}

/** Revisions are timestamped by three different writers, so `update_time` is a
 * Firestore Timestamp, an ISO string or missing depending on its age. */
function revisionTime(revision: Revision): number {
  const value = revision.update_time as unknown;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value && typeof value === "object" && "_seconds" in value) {
    return (value as { _seconds: number })._seconds * 1000;
  }
  return 0;
}

/** Revisions for a batch of edges at once, newest first, keyed by edge id.
 *
 * One query per 30 ids rather than one per edge: a page listing a node's
 * relations, or a publish of a hundred of them, would otherwise spend a round
 * trip on each. 30 is Firestore's ceiling for `in`.
 */
export async function edgeRevisionsForMany(
  db: Firestore,
  edgeIds: string[],
): Promise<Map<string, (Revision & { id: string })[]>> {
  const result = new Map<string, (Revision & { id: string })[]>();
  for (const id of edgeIds) result.set(id, []);
  if (edgeIds.length === 0) return result;

  for (let i = 0; i < edgeIds.length; i += 30) {
    const chunk = edgeIds.slice(i, i + 30);
    const snap = await db
      .collection("revisions")
      .where("node_id", "in", chunk)
      .get();
    for (const doc of snap.docs) {
      const revision = { id: doc.id, ...(doc.data() as Revision) };
      const target = revision.node_id;
      if (target) result.get(target)?.push(revision);
    }
  }

  for (const revisions of result.values()) {
    revisions.sort((a, b) => revisionTime(b) - revisionTime(a));
  }
  return result;
}

/** The revision to approve when publishing an edge that points at none.
 *
 * The newest one that has not been rejected and that the edge already holds -
 * *not* the newest still marked pending. An edge can carry an approved
 * revision without pointing at it: the pointer is written by whatever applied
 * the revision, and the ingest paths, the dedupe script and every document
 * written before `status` existed have all left the two out of step. Asking
 * for `status === "pending"` found nothing for those, so the relation had no
 * candidate and the reviewer was told a proposal was waiting on a queue that
 * would never clear.
 *
 * Held, because publishing changes who may see the edge and not what it says.
 * A proposal says something the edge does not - `proposeRevisionTransaction`
 * leaves the edge alone - and it is also the revision most likely to be the
 * newest, since the pipeline files its committee proposals after the
 * candidacy. Taking the newest regardless had marked 33 committee proposals
 * and corrections approved by 2026-10-09 without any of them reaching its
 * edge, so they left the review queue unapplied, and the ingest, still finding
 * the edge without its committee, proposed it again. A proposal the edge does
 * not hold stays pending, in /admin/rewizje#powiazania, for whoever approves
 * it to apply.
 *
 * A rejected revision is skipped rather than resurrected - somebody said no to
 * it, and publishing the relation is not a reason to undo that. Where no
 * revision qualifies there is no candidate, and the edge is published on the
 * strength of its own document.
 */
export function publishCandidateRevision(
  revisions: (Revision & { id: string })[],
  stored: Record<string, unknown>,
): (Revision & { id: string }) | undefined {
  return revisions.find(
    (revision) =>
      revision.status !== "rejected" && holdsRevision(stored, revision.data),
  );
}

/** Whether somebody is actually waiting on a verdict for this relation.
 *
 * Stricter than `revisionIsPending`, on purpose: that treats a *missing*
 * `status` as pending, which is right when the question is "has this been
 * settled" but wrong when the question is "is there a proposal in the queue".
 * Every revision written before the field existed has no status - all 28k of
 * them - so the looser reading labelled every legacy relation as a proposal
 * awaiting review, which told the reviewer the same untrue thing about all of
 * them.
 */
export function hasPendingRevision(
  revisions: (Revision & { id: string })[],
): boolean {
  return revisions.some((revision) => revision.status === "pending");
}

/** Publishes one edge, and points it at a revision if it points at none.
 *
 * Publishing a relation *is* the review of it: the reviewer looked at the claim
 * and decided the public should see it. So an edge whose `revision_id` is unset
 * is pointed at the newest un-rejected revision it already holds, in the same
 * commit, and that revision is marked approved - see `publishCandidateRevision`
 * for which revision that is and why. A proposal the edge does not hold is
 * left pending: publishing is a decision about the edge as it stands, and
 * approving the proposal, which is what would put it on the edge, is a
 * separate one.
 *
 * The edge's revisions come in rather than a revision picked by the caller,
 * so the rule is this function's to keep and no caller can hand it a
 * proposal to adopt.
 *
 * An edge that predates the revision machinery has neither pointer nor
 * revision, and is published on the strength of the document itself; refusing
 * would hide relations that were never written through a revision at all.
 *
 * Writes into `batch`; the caller decides how many edges share a commit.
 */
export function publishEdgeInBatch(
  db: Firestore,
  batch: WriteBatch,
  edgeRef: DocumentReference,
  stored: Record<string, unknown>,
  /** Every revision of the edge, newest first, as `edgeRevisions` and
   * `edgeRevisionsForMany` return them. */
  revisions: (Revision & { id: string })[],
  user: { uid: string },
  /** False for the ingest publishing on its own authority. The audit log is a
   * record of administrators' decisions, and an automatic approval is already
   * recorded on the revision it approves - `review_user` is the pipeline - the
   * way every other write the ingest approves is. */
  audit = true,
): { approvedRevision: string | null } {
  const update: Record<string, unknown> = { published: true };
  let approvedRevision: string | null = null;

  const candidate = approvedRevisionId(stored.revision_id)
    ? undefined
    : publishCandidateRevision(revisions, stored);
  if (candidate) {
    const revisionRef = db.collection("revisions").doc(candidate.id);
    const timestamp = Timestamp.now();
    batch.update(revisionRef, {
      status: "approved",
      review_user: user.uid,
      review_time: timestamp,
      reject_reason: FieldValue.delete(),
    });
    update.revision_id = revisionRef;
    approvedRevision = candidate.id;
    if (audit) {
      recordAudit(
        db,
        {
          action: "approve",
          collection: "edges",
          target_id: edgeRef.id,
          revision_id: candidate.id,
          user: user.uid,
        },
        batch,
      );
    }
  }

  // `update`, not `set`: unlike applying a revision this changes who may see
  // the edge, not what it says, and the stored document already holds the
  // approved snapshot - `publishCandidateRevision` makes sure of that. A full
  // overwrite here would drop `votes` and `stats`.
  batch.update(edgeRef, update);
  if (audit) {
    recordAudit(
      db,
      {
        action: "publish",
        collection: "edges",
        target_id: edgeRef.id,
        ...(approvedRevision ? { revision_id: approvedRevision } : {}),
        user: user.uid,
      },
      batch,
    );
  }

  return { approvedRevision };
}

/** Hides one edge. The proposal it was published from is left alone - taking a
 * relation off the site says nothing about whether the claim was right. */
export function unpublishEdgeInBatch(
  db: Firestore,
  batch: WriteBatch,
  edgeRef: DocumentReference,
  user: { uid: string },
): void {
  batch.update(edgeRef, { published: false });
  recordAudit(
    db,
    {
      action: "unpublish",
      collection: "edges",
      target_id: edgeRef.id,
      user: user.uid,
    },
    batch,
  );
}

/** Every edge with `nodeId` at either end. */
export async function fetchEdgesForNode(
  db: Firestore,
  nodeId: string,
): Promise<(Edge & { id: string })[]> {
  const [bySource, byTarget] = await Promise.all([
    db.collection("edges").where("source", "==", nodeId).get(),
    db.collection("edges").where("target", "==", nodeId).get(),
  ]);

  // A self-edge comes back from both queries.
  const edges = new Map<string, Edge & { id: string }>();
  for (const doc of [...bySource.docs, ...byTarget.docs]) {
    if (!edges.has(doc.id)) {
      edges.set(doc.id, { id: doc.id, ...(doc.data() as Edge) });
    }
  }
  return Array.from(edges.values());
}

/** How many edges share one commit.
 *
 * Each edge costs an update plus an audit row, and approving the revision it
 * holds adds two more, so 100 edges stay under Firestore's 500-write batch
 * limit in the worst case.
 */
export const EDGE_PUBLISH_CHUNK = 100;

/** Takes every published edge of a node off the site, because the node is
 * going off it.
 *
 * The rule that no edge outlives its endpoints has to hold in this direction
 * too. Nothing a reader sees changes - the graph endpoint already drops an edge
 * whose node was filtered out - but the flag would otherwise survive the node
 * being hidden, and republishing the node months later would bring back
 * relations nobody reviewed in the meantime.
 *
 * Returns the ids it hid, for the caller's audit trail and response.
 */
export async function cascadeUnpublishEdges(
  db: Firestore,
  nodeId: string,
  user: { uid: string },
): Promise<string[]> {
  const edges = await fetchEdgesForNode(db, nodeId);
  const live = edges.filter((edge) => pageIsPublic(edge));
  if (live.length === 0) return [];

  for (let i = 0; i < live.length; i += EDGE_PUBLISH_CHUNK) {
    const chunk = live.slice(i, i + EDGE_PUBLISH_CHUNK);
    const batch = db.batch();
    for (const edge of chunk) {
      unpublishEdgeInBatch(
        db,
        batch,
        db.collection("edges").doc(edge.id),
        user,
      );
    }
    await batch.commit();
  }

  console.info(
    `Unpublished ${live.length} edge(s) alongside node=${nodeId} by=${user.uid}`,
  );
  return live.map((edge) => edge.id);
}
