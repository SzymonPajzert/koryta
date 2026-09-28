import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
  type WriteBatch,
} from "firebase-admin/firestore";
import {
  edgeIdentity,
  edgeRelation,
  edgeSemantics,
  enrichedEdge,
  meetsEnrichFloor,
  type EdgeLike,
} from "./edges";
import { createRevisionTransaction, withoutInternalFields } from "./revisions";
import { recordAudit } from "./audit";
// Imported explicitly rather than left to Nuxt's auto-import: this module is
// also loaded by scripts/migrate/merge-duplicate-people.ts under plain tsx,
// where there is no auto-import and a missing one is a ReferenceError at
// runtime that typecheck cannot see.
import { sortParties } from "../../shared/misc";
import { asArray } from "../../shared/model";
import { isPipelineUid } from "../../shared/stats";

/** What becomes of one relation when the page it hangs off is merged away.
 *
 * - `moved`: the survivor does not say this, so the relation is re-pointed at
 *   it and kept. The ordinary case.
 * - `collapsed`: the survivor already says exactly this, and the edge type is
 *   one where saying it twice asserts nothing new. Removed.
 * - `review`: the survivor already says exactly this, and the type is one where
 *   identical fields are *not* evidence of one fact. Kept, and reported - see
 *   `identicalMeansSame` in `server/utils/edges.ts`, which is the same
 *   judgement `scripts/migrate/dedupe-edges.ts` makes.
 * - `enriched`: the survivor states a poorer version of this - a candidacy with
 *   no committee against one with it - so the two are one fact and the better
 *   informed of them wins. The survivor's relation takes what this one knows and
 *   this one goes. Only for an `enrichable` type, where a blank means "not known
 *   yet" rather than "there was none".
 * - `self`: both ends were the duplicate, so the merge would leave the survivor
 *   pointing at itself. Removed; a loop is not a fact about anybody.
 */
export type MergeVoteMove = {
  /** The vote document on the duplicate, which is deleted once it is re-filed. */
  from_id: string;
  /** `${survivor}_${uid}`, the id the same vote takes on the surviving page. */
  to_id: string;
  user: string;
};

export type MergeDisposition =
  "moved" | "collapsed" | "enriched" | "review" | "self";

export type MergeEdgePlan = {
  edge_id: string;
  type: string;
  disposition: MergeDisposition;
  /** Which end of the relation named the duplicate. */
  role: "source" | "target" | "both";
  /** The survivor's relation that already says this, for a `collapsed`,
   * `enriched` or `review` verdict. */
  duplicate_of?: string;
  /** What the survivor's relation should say once this one's fields are folded
   * into it. Only on an `enriched` verdict. */
  enriches_into?: Record<string, unknown>;
};

export type MergePlan = {
  duplicate_id: string;
  survivor_id: string;
  /** Both names, for a dry run to print something a human can check. */
  duplicate_name?: string;
  survivor_name?: string;
  edges: MergeEdgePlan[];
  counts: Record<MergeDisposition, number>;
  /** Human votes on the duplicate that the survivor has none of, by the id the
   * moved document takes. See `votesToMove`. */
  votes: MergeVoteMove[];
  /** What the duplicate knows and the survivor does not, to be written onto the
   * survivor rather than left on the tombstone. See `carriedFields`. */
  carried: Record<string, unknown>;
};

/** How far `merged_into` is followed before the data is called broken.
 *
 * Merges are resolved on the way in, so a chain should never form. This is what
 * stops a cycle - two pages merged into each other by two admins racing - from
 * hanging a page load rather than failing it.
 */
const MAX_MERGE_HOPS = 8;

/** The page a reader should end up on, following `merged_into` to the end.
 *
 * Returns the id it was given when the page is not a duplicate, which is the
 * usual answer and costs one read.
 */
export async function resolveMergedNode(
  db: Firestore,
  id: string,
): Promise<{ id: string; snapshot: DocumentSnapshot | undefined }> {
  let current = id;
  const seen = new Set<string>([id]);

  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const snapshot = await db.collection("nodes").doc(current).get();
    if (!snapshot.exists) return { id: current, snapshot: undefined };

    const next = snapshot.data()?.merged_into;
    if (typeof next !== "string" || !next) return { id: current, snapshot };

    // A cycle is a bug in whatever wrote the second pointer, and the page it
    // was reached from is still a better answer than a hang.
    if (seen.has(next)) return { id: current, snapshot };
    seen.add(next);
    current = next;
  }

  const snapshot = await db.collection("nodes").doc(current).get();
  return { id: current, snapshot: snapshot.exists ? snapshot : undefined };
}

/** Every relation with the given node at either end. */
export async function edgesTouching(db: Firestore, nodeId: string) {
  const [asSource, asTarget] = await Promise.all([
    db.collection("edges").where("source", "==", nodeId).get(),
    db.collection("edges").where("target", "==", nodeId).get(),
  ]);

  const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of [...asSource.docs, ...asTarget.docs]) byId.set(doc.id, doc);
  return [...byId.values()];
}

/** The relation as it would read once the duplicate's id is replaced. */
function remapped(
  stored: Record<string, unknown>,
  duplicateId: string,
  survivorId: string,
): EdgeLike {
  return {
    ...stored,
    source: stored.source === duplicateId ? survivorId : stored.source,
    target: stored.target === duplicateId ? survivorId : stored.target,
  } as EdgeLike;
}

/** Every vote cast on a node, as `votesToMove` reads them. */
export async function nodeVotes(
  db: Firestore,
  nodeId: string,
): Promise<{ id: string; user: string; data: Record<string, unknown> }[]> {
  const snap = await db.collection("votes").where("nodeId", "==", nodeId).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    user: String(doc.data().userUid ?? ""),
    data: doc.data(),
  }));
}

/** The votes worth re-filing onto the survivor, and only those.
 *
 * Human votes only. A model's vote is regenerated every scoring run and there
 * are six models; on the 171 pairs stored on 2026-08-31 they account for 535 of
 * the 565 votes, and carrying them would put a stale score on the survivor that
 * the next run overwrites anyway - while briefly making `stats.votes.models`
 * read as two models' worth of one. The 30 human votes are the ones nothing
 * regenerates.
 *
 * A vote already cast by that person on the survivor stops the move. The
 * document id is `${nodeId}_${userUid}`, so the two would collide, and the
 * vote on the page that survives is the one to keep: it is about the page the
 * reader will actually see. The duplicate's is left where it is rather than
 * deleted, so the record of what they thought is still readable on the
 * tombstone.
 */
export function votesToMove(
  duplicateVotes: { id: string; user: string }[],
  survivorVotes: { user: string }[],
  survivorId: string,
): MergeVoteMove[] {
  const alreadyVoted = new Set(survivorVotes.map((v) => v.user));
  return duplicateVotes
    .filter((v) => !isPipelineUid(v.user))
    .filter((v) => !alreadyVoted.has(v.user))
    .map((v) => ({
      from_id: v.id,
      to_id: `${survivorId}_${v.user}`,
      user: v.user,
    }));
}

/** Fields the merge moves across, and how.
 *
 * Relations are re-pointed, so nothing about them depends on which page wins.
 * Fields are not, and until they were carried the choice of survivor silently
 * decided how much the site still knew: against the 171 duplicate pairs stored
 * on 2026-08-31, 22 of them had party lists on the page that was about to
 * become a tombstone, and reordering the survivor rule to prefer the fuller
 * name took that to 71 - because the fuller name is usually the older page, and
 * the newer one is where the recent upload put the parties. Carrying them makes
 * the question moot rather than answering it better.
 *
 * `parties` is a set union, for the reason `updatedPerson` gives: two runs can
 * each find a different half of somebody's career and neither is a correction
 * of the other. Everything else is filled in only where the survivor has
 * nothing, so the surviving page never has a value overwritten - a merge is not
 * the place to overrule a reviewer.
 *
 * `name` is deliberately not carried. Which page survives *is* the decision
 * about what it is called, and renaming it here would quietly undo the choice
 * an admin just made in the dialog.
 */
export function carriedFields(
  duplicate: Record<string, unknown>,
  survivor: Record<string, unknown>,
): Record<string, unknown> {
  const carried: Record<string, unknown> = {};

  const parties = sortParties(
    new Set([
      ...asArray<string>(survivor.parties as string[]),
      ...asArray<string>(duplicate.parties as string[]),
    ]),
  );
  if (parties.length > asArray<string>(survivor.parties as string[]).length) {
    carried.parties = parties;
  }

  for (const [key, value] of Object.entries(withoutInternalFields(duplicate))) {
    if (key === "parties" || key === "name" || key === "type") continue;
    if (value === undefined || value === null || value === "") continue;
    const held = survivor[key];
    if (held === undefined || held === null || held === "")
      carried[key] = value;
  }

  return carried;
}

/** Where each of `moving` ends up once its `fromId` end reads `toId` instead.
 *
 * Pure, and shared by the merge and the split: both are the same question -
 * this relation is about to name a different page, does that page already say
 * it - and answering it two ways would let a merge remove what a split had just
 * decided to keep.
 *
 * `destination` is every relation the receiving page already holds, so the
 * count of what it says is the count this reasons against.
 */
export function planEdgeMoves(
  moving: FirebaseFirestore.QueryDocumentSnapshot[],
  destination: FirebaseFirestore.QueryDocumentSnapshot[],
  fromId: string,
  toId: string,
): MergeEdgePlan[] {
  // How many times the receiving page already asserts each thing. An occurrence
  // type may legitimately assert one twice, so this counts rather than just
  // records.
  const held = new Map<string, string[]>();
  //: The receiving page's relations by `(target, type)`, which is as close as
  //: two can be without asserting the same thing - that is the set `enriches`
  //: has to be searched over, because an edge that fills in a committee has a
  //: different identity from the one it is filling in.
  const byPair = new Map<string, { id: string; stored: EdgeLike }[]>();
  const claimed = new Set<string>();
  for (const doc of destination) {
    const stored = doc.data();
    if (stored.deleted === true) continue;
    const identity = edgeIdentity(stored as EdgeLike);
    held.set(identity, [...(held.get(identity) ?? []), doc.id]);
    const pair = `${stored.target}\u0000${stored.type}`;
    byPair.set(pair, [
      ...(byPair.get(pair) ?? []),
      { id: doc.id, stored: stored as EdgeLike },
    ]);
  }

  const edges: MergeEdgePlan[] = [];
  // Sorted so a dry run predicts the run that follows it, the way
  // `findEdgeMatches` sorts for the same reason.
  for (const doc of [...moving].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const stored = doc.data();
    if (stored.deleted === true) continue;

    const role: MergeEdgePlan["role"] =
      stored.source === fromId && stored.target === fromId
        ? "both"
        : stored.source === fromId
          ? "source"
          : "target";

    const next = remapped(stored, fromId, toId);
    const type = String(stored.type);

    if (next.source === next.target) {
      edges.push({ edge_id: doc.id, type, role, disposition: "self" });
      continue;
    }

    const identity = edgeIdentity(next);
    const alreadySaid = held.get(identity) ?? [];

    if (alreadySaid.length > 0) {
      const { identicalMeansSame } = edgeSemantics(next.type);
      const duplicate_of = alreadySaid[0];
      if (identicalMeansSame) {
        edges.push({
          edge_id: doc.id,
          type,
          role,
          disposition: "collapsed",
          duplicate_of,
        });
        continue;
      }
      // Kept, and counted as held: two of the moving page's candidacies that
      // look alike are still two, and only the first of them is worth
      // reporting against the receiving page's one.
      held.set(identity, [...alreadySaid, doc.id]);
      edges.push({
        edge_id: doc.id,
        type,
        role,
        disposition: "review",
        duplicate_of,
      });
      continue;
    }

    // Nothing says exactly this, but the survivor may say a better-informed
    // version of it. `TY8bMoaheJqzINdOTIoJ` held three candidacies with no
    // party and no committee against the same three on `XGPwmZjJII22uoMWvZWz`
    // with both, and identity alone cannot see that they are one fact: party
    // and committee are discriminators, so the poorer copy hashes elsewhere and
    // lands beside the richer one. This is the same question
    // `findEdgeOrCreate` asks of an incoming payload row, asked of a relation
    // arriving from the other page, and answered by the same function.
    const { enrichable } = edgeSemantics(next.type);
    if (enrichable) {
      const candidates = (byPair.get(`${next.target}\u0000${next.type}`) ?? [])
        .filter((c) => !claimed.has(c.id))
        .filter((c) => meetsEnrichFloor(c.stored));
      // Claimed one for one: two candidacies the survivor holds are two facts,
      // and letting both of the duplicate's fold onto the first would lose one.
      const match = candidates.find(
        (c) => edgeRelation(c.stored, next) !== "conflict",
      );
      if (match) {
        claimed.add(match.id);
        const relation = edgeRelation(match.stored, next);
        if (relation === "same") {
          edges.push({
            edge_id: doc.id,
            type,
            role,
            disposition: "collapsed",
            duplicate_of: match.id,
          });
          continue;
        }
        edges.push({
          edge_id: doc.id,
          type,
          role,
          disposition: "enriched",
          duplicate_of: match.id,
          // Both sides stripped. `next` is the stored document as it was read,
          // so it still carries `revision_id` - a real DocumentReference, which
          // `enrichedEdge` would copy across because the stripped survivor
          // lacks one. `sanitizeFirestoreData` then walks it, and a
          // DocumentReference holds its Firestore instance, which holds every
          // reference made from it: "RangeError: Maximum call stack size
          // exceeded" out of `sanitizeValue`, which has no cycle guard.
          enriches_into: enrichedEdge(
            withoutInternalFields(match.stored as Record<string, unknown>),
            withoutInternalFields(next as Record<string, unknown>) as EdgeLike,
          ),
        });
        continue;
      }
    }

    held.set(identity, [doc.id]);
    byPair.set(`${next.target}\u0000${next.type}`, [
      ...(byPair.get(`${next.target}\u0000${next.type}`) ?? []),
      { id: doc.id, stored: next },
    ]);
    edges.push({ edge_id: doc.id, type, role, disposition: "moved" });
  }

  return edges;
}

/** How many of each verdict a plan reached. */
export function countDispositions(
  edges: MergeEdgePlan[],
): Record<MergeDisposition, number> {
  const counts: Record<MergeDisposition, number> = {
    moved: 0,
    collapsed: 0,
    enriched: 0,
    review: 0,
    self: 0,
  };
  for (const edge of edges) counts[edge.disposition]++;
  return counts;
}

/** What merging `duplicateId` into `survivorId` would do, without doing it.
 *
 * Split from the write so the same reasoning backs the endpoint, its dry run
 * and the one-off migration - a merge is not a thing to work out twice.
 *
 * A relation removed earlier (`deleted`) is left where it is: it asserts
 * nothing, so moving it would only add a second dead copy to the survivor, and
 * the reason it was removed was recorded against the page it was removed from.
 */
export async function planNodeMerge(
  db: Firestore,
  duplicateId: string,
  survivorId: string,
): Promise<MergePlan> {
  const [duplicateDoc, survivorDoc] = await db.getAll(
    db.collection("nodes").doc(duplicateId),
    db.collection("nodes").doc(survivorId),
  );

  const [duplicateEdges, survivorEdges, duplicateVotes, survivorVotes] =
    await Promise.all([
      edgesTouching(db, duplicateId),
      edgesTouching(db, survivorId),
      nodeVotes(db, duplicateId),
      nodeVotes(db, survivorId),
    ]);

  const edges = planEdgeMoves(
    duplicateEdges,
    survivorEdges,
    duplicateId,
    survivorId,
  );

  return {
    duplicate_id: duplicateId,
    survivor_id: survivorId,
    duplicate_name: duplicateDoc?.data()?.name as string | undefined,
    survivor_name: survivorDoc?.data()?.name as string | undefined,
    edges,
    counts: countDispositions(edges),
    votes: votesToMove(duplicateVotes, survivorVotes, survivorId),
    carried: carriedFields(
      duplicateDoc?.data() ?? {},
      survivorDoc?.data() ?? {},
    ),
  };
}

/** Why a merge cannot be made, or nothing. */
export function mergeRefusal(
  plan: { duplicate_id: string; survivor_id: string },
  duplicate: DocumentSnapshot | undefined,
  survivor: DocumentSnapshot | undefined,
): string | undefined {
  if (plan.duplicate_id === plan.survivor_id) {
    return "Nie można scalić strony z nią samą.";
  }
  if (!duplicate?.exists) {
    return `Nie ma strony o id: ${plan.duplicate_id}`;
  }
  if (!survivor?.exists) {
    return `Nie ma strony o id: ${plan.survivor_id}`;
  }

  const duplicateData = duplicate.data() ?? {};
  const survivorData = survivor.data() ?? {};

  if (duplicateData.type !== survivorData.type) {
    return (
      `Strony są różnego rodzaju: ${duplicateData.type} i ` +
      `${survivorData.type}. Scalać można tylko strony tego samego rodzaju.`
    );
  }
  if (typeof duplicateData.merged_into === "string") {
    return `Strona ${plan.duplicate_id} została już scalona z ${duplicateData.merged_into}.`;
  }
  return undefined;
}

/** Carry out the plan: move the relations, then put the duplicate to rest.
 *
 * A moved relation is updated in place rather than rewritten at the document id
 * its new ends would hash to. `findEdgeMatches` looks an edge up by
 * `(source, target, type)` and not by id, so a stale id costs nothing: the next
 * ingest still finds the relation and reuses it. Rewriting it would cost the
 * revisions filed against the old id, which are the only record of who said
 * this and when.
 *
 * A collapsed relation is soft-deleted with a revision, exactly as
 * `/api/edges/delete` removes one - the reason it went is worth keeping, and it
 * is the half of the merge most likely to have been wrong.
 */
export function applyNodeMerge(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  plan: MergePlan,
  reason: string,
  storedEdges: Map<string, Record<string, unknown>>,
  /** The surviving node as stored, needed only to layer `plan.carried` over it
   * - a revision is written with `set`, so it has to state the whole document.
   * Omitted by a caller with nothing to carry. */
  storedSurvivor?: Record<string, unknown>,
  /** The duplicate's vote documents by id, for the human ones being re-filed. */
  storedVotes?: Map<string, Record<string, unknown>>,
): void {
  const moved: string[] = [];
  const collapsed: string[] = [];
  const enriched: string[] = [];

  for (const edge of plan.edges) {
    const edgeRef = db.collection("edges").doc(edge.edge_id);
    const stored = storedEdges.get(edge.edge_id);
    if (!stored) continue;

    if (edge.disposition === "moved" || edge.disposition === "review") {
      const update: Record<string, string> = {};
      if (stored.source === plan.duplicate_id) update.source = plan.survivor_id;
      if (stored.target === plan.duplicate_id) update.target = plan.survivor_id;
      batch.update(edgeRef, update);
      moved.push(edge.edge_id);
      continue;
    }

    // An enriched relation is two writes: the survivor's copy learns what this
    // one knew, and this one goes the way a collapsed one does. Written as a
    // revision, approved, because it changes what a relation asserts and that
    // is the one thing revisions exist to record.
    if (edge.disposition === "enriched" && edge.enriches_into) {
      const target = storedEdges.get(edge.duplicate_of ?? "");
      if (target) {
        createRevisionTransaction(
          db,
          batch,
          user,
          db.collection("edges").doc(edge.duplicate_of!),
          edge.enriches_into,
          { stored: target, approve: true },
        );
        enriched.push(edge.duplicate_of!);
      }
    }

    // `deleted` and `delete_reason` are withheld from `stored` so this revision
    // is the one that states them; carrying them back would undo the removal on
    // the way out. Same reasoning as /api/edges/delete.
    const {
      deleted: _wasDeleted,
      delete_reason: _oldReason,
      ...carried
    } = stored;
    createRevisionTransaction(
      db,
      batch,
      user,
      edgeRef,
      {
        ...withoutInternalFields(stored),
        deleted: true,
        delete_reason:
          edge.disposition === "self"
            ? `Scalenie stron: powiązanie prowadziło samo do siebie. ${reason}`
            : edge.disposition === "enriched"
              ? `Scalenie stron: to samo, pełniej, mówi powiązanie ${edge.duplicate_of}. ${reason}`
              : `Scalenie stron: to samo mówi już powiązanie ${edge.duplicate_of}. ${reason}`,
      },
      // An admin merging two pages *is* the review of what the merge removes.
      { stored: carried, approve: true, published: false },
    );
    collapsed.push(edge.edge_id);
  }

  // What the duplicate knew and the survivor did not, written onto the survivor
  // before the duplicate is put beyond reach. A revision rather than an update,
  // because it changes what the page says and that is what revisions are for -
  // and approved as it is written, on the same authority as the rest of the
  // merge.
  if (storedSurvivor && Object.keys(plan.carried).length > 0) {
    createRevisionTransaction(
      db,
      batch,
      user,
      db.collection("nodes").doc(plan.survivor_id),
      { ...withoutInternalFields(storedSurvivor), ...plan.carried },
      { stored: storedSurvivor, approve: true },
    );
  }

  // Each human vote re-filed under the survivor's id and removed from the
  // duplicate's. A vote document is `${nodeId}_${userUid}` and carries `nodeId`
  // in its body, so both have to change; a plain update would leave the id
  // disagreeing with the field and the next vote by that person would write a
  // second document.
  for (const vote of plan.votes) {
    const stored = storedVotes?.get(vote.from_id);
    if (!stored) continue;
    batch.set(db.collection("votes").doc(vote.to_id), {
      ...stored,
      nodeId: plan.survivor_id,
    });
    batch.delete(db.collection("votes").doc(vote.from_id));
  }

  // The duplicate keeps its document, and keeps pointing at the survivor. Its
  // url still resolves, its votes and revisions still have something to hang
  // off, and `pageIsPublic` already reads `deleted` - so it leaves the public
  // site on the next read without anything else learning a new rule. Its stats
  // go with it, as /api/stats/computeNodes leaves them off every tombstone:
  // kept, they would hold its place in every list and queue queried on them
  // until the next recount.
  const duplicateRef = db.collection("nodes").doc(plan.duplicate_id);
  batch.update(duplicateRef, {
    deleted: true,
    delete_reason: reason,
    merged_into: plan.survivor_id,
    published: false,
    stats: FieldValue.delete(),
  });

  recordAudit(
    db,
    {
      action: "merge",
      collection: "nodes",
      target_id: plan.duplicate_id,
      user: user.uid,
      reason,
      merge: { into: plan.survivor_id, moved, collapsed, enriched },
    },
    batch,
  );
}
