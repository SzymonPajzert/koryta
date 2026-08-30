import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import type { H3Event } from "h3";
import { getUser } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import { pageIsPublic } from "~~/shared/model";
import type { EdgeType, NodeType } from "~~/shared/model";

const bodyValidator = z.object({
  add: z.array(z.string().min(1)).optional(),
  remove: z.array(z.string().min(1)).optional(),
});

/** One of an article's own relations, as the page renders it back. */
export type ArticleEdgeState = {
  edgeId: string;
  nodeId: string;
  published: boolean;
};

/** What separates one kind of article relation from another. */
export type ArticleEdgeKind = {
  type: EdgeType;
  /** What the far end has to be for the write to be accepted. */
  targetTypes: readonly NodeType[];
  /** Whether the type is stored with the article at either end.
   *
   * `tagged` only ever points article → topic. `mentions` is stored both ways:
   * this endpoint and `useEdgeTypes.ts` write article → person, while
   * `ingest/person.post.ts` writes person → article and produced most of the
   * ones in the database. Reading one direction would offer to add a mention
   * that is already there, and refuse to remove one the pipeline wrote.
   */
  bothDirections?: boolean;
  /** 400, when the caller named nothing to do. */
  nothingNamed: string;
  /** 422, when the far end is not a node this relation may point at. */
  wrongTarget: (id: string) => string;
};

/** Adds relations of one kind to an article, or takes them off it.
 *
 * Adding writes an edge as a draft, removing marks the existing one `deleted`.
 * Scoped to one kind of relation rather than exposed as a general "delete this
 * edge", because it needs no more than a signed in reader and a general one at
 * that price would let anybody take an employment claim off the site. Removing
 * any other kind of relation stays with the admin flow.
 *
 * Additive, like `/api/edges/[id]/references`: the caller names what changed
 * rather than sending the list it rendered, so two people editing the same
 * article do not overwrite each other.
 */
export async function changeArticleEdges(
  event: H3Event,
  kind: ArticleEdgeKind,
): Promise<ArticleEdgeState[]> {
  const articleId = getRouterParam(event, "id");
  if (!articleId) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }

  const body = bodyValidator.parse(await readBody(event));
  const add = Array.from(new Set(body.add ?? []));
  const remove = new Set(body.remove ?? []);
  if (add.length === 0 && remove.size === 0) {
    throw createError({ statusCode: 400, message: kind.nothingNamed });
  }

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const articleSnap = await db.collection("nodes").doc(articleId).get();
  if (!articleSnap.exists || articleSnap.data()?.type !== "article") {
    throw createError({
      statusCode: 404,
      message: "Nie ma takiego artykułu.",
    });
  }

  const targetSnaps = add.length
    ? await db.getAll(...add.map((id) => db.collection("nodes").doc(id)))
    : [];
  for (const snap of targetSnaps) {
    const type = snap.data()?.type as NodeType | undefined;
    if (!snap.exists || !type || !kind.targetTypes.includes(type)) {
      throw createError({
        statusCode: 422,
        message: kind.wrongTarget(snap.id),
      });
    }
  }

  const existing = await existingEdges(db, articleId, kind);

  const batch = db.batch();

  for (const targetId of add) {
    if (existing.has(targetId)) continue;
    const edgeRef = db.collection("edges").doc();
    createRevisionTransaction(
      db,
      batch,
      user,
      edgeRef,
      // No `references`: what an article says, and which story it belongs to,
      // are claims about the article itself rather than ones resting on some
      // other source.
      { source: articleId, target: targetId, type: kind.type },
      // Live for whoever is signed in, hidden from the public until a reviewer
      // approves it - the same terms as every other relation somebody proposes.
      { published: false },
    );
  }

  for (const targetId of remove) {
    // Every edge saying it, not just the first: a person the pipeline recorded
    // and a reader then recorded again is two documents, and removing one of
    // them would put the chip straight back on the next read.
    for (const doc of existing.get(targetId) ?? []) {
      // `deleted` is a field the document owns, so `createRevisionTransaction`
      // layers whatever `stored` says for it back over the revision. An edge
      // written by the old client helper carries `deleted: false` outright, and
      // carrying that across would undo this removal on the way out.
      // Withholding the key is what lets the revision be the one to state it.
      const { deleted: _wasDeleted, ...stored } = doc.data();
      createRevisionTransaction(
        db,
        batch,
        user,
        doc.ref,
        { ...withoutInternalFields(doc.data()), deleted: true },
        { stored, published: false },
      );
    }
  }

  await batch.commit();

  const after = await existingEdges(db, articleId, kind);
  return Array.from(after.entries()).map(([nodeId, docs]) => {
    // The published one is what the public would be shown, so it is the one
    // that decides whether the caller renders this as a draft.
    const doc = docs.find((entry) => pageIsPublic(entry.data())) ?? docs[0]!;
    return { edgeId: doc.id, nodeId, published: pageIsPublic(doc.data()) };
  });
}

/** What an article's `mentions` relation is, shared by everything that writes
 * one. `bothDirections` because the pipeline stores person -> article while the
 * app stores article -> person; see `ArticleEdgeKind`. */
export const MENTIONS: ArticleEdgeKind = {
  type: "mentions",
  targetTypes: ["person", "place"],
  bothDirections: true,
  nothingNamed: "Nie podano osób do dodania ani usunięcia.",
  wrongTarget: (id) => `${id} nie jest osobą ani instytucją w bazie.`,
};

/** Records that an article names these nodes, on the caller's batch.
 *
 * Split out of `changeArticleEdges` so that a caller which is already writing
 * the article itself - promoting a note's source - can record the mention in the
 * same commit, rather than making a second request that can fail on its own and
 * leave an article nobody is joined to.
 *
 * Skips a node the article is already joined to, whichever way round the edge
 * was stored, which is what keeps this idempotent: promoting the same note
 * twice, or promoting a url the extraction pipeline already linked to this
 * person, writes nothing the second time. Silently ignores a node that is not a
 * person or a company - a note hangs off regions and topics too, and neither is
 * something `mentions` is declared for.
 *
 * Returns the ids it wrote an edge for.
 */
export async function addArticleMentions(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  user: { uid: string },
  articleId: string,
  targetIds: string[],
): Promise<string[]> {
  const wanted = Array.from(new Set(targetIds)).filter((id) => id !== articleId);
  if (wanted.length === 0) return [];

  const [existing, snaps] = await Promise.all([
    existingEdges(db, articleId, MENTIONS),
    db.getAll(...wanted.map((id) => db.collection("nodes").doc(id))),
  ]);

  const mentionable = new Set(
    snaps
      .filter((snap) => {
        const type = snap.data()?.type as NodeType | undefined;
        return !!type && MENTIONS.targetTypes.includes(type);
      })
      .map((snap) => snap.id),
  );

  const written: string[] = [];
  for (const targetId of wanted) {
    if (!mentionable.has(targetId) || existing.has(targetId)) continue;
    const edgeRef = db.collection("edges").doc();
    createRevisionTransaction(
      db,
      batch,
      user,
      edgeRef,
      { source: articleId, target: targetId, type: MENTIONS.type },
      // A draft, the same terms as a mention added by hand on the article page:
      // a reader saying "this page is about them" is a claim, not a fact, and
      // the article node it hangs off may itself be waiting for review.
      { published: false },
    );
    written.push(targetId);
  }
  return written;
}

/** The article's live edges of this kind, grouped by the node at the far end.
 *
 * A list rather than one document per node, because two writers who do not know
 * about each other can each have recorded the same thing. */
async function existingEdges(
  db: FirebaseFirestore.Firestore,
  articleId: string,
  kind: ArticleEdgeKind,
) {
  const queries = [
    db
      .collection("edges")
      .where("source", "==", articleId)
      .where("type", "==", kind.type)
      .get(),
  ];
  if (kind.bothDirections) {
    queries.push(
      db
        .collection("edges")
        .where("target", "==", articleId)
        .where("type", "==", kind.type)
        .get(),
    );
  }

  const found = new Map<
    string,
    FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]
  >();
  const seen = new Set<string>();
  for (const snapshot of await Promise.all(queries)) {
    for (const doc of snapshot.docs) {
      // A self-edge comes back from both queries.
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const data = doc.data();
      if (data.deleted === true) continue;
      const far = data.source === articleId ? data.target : data.source;
      if (typeof far !== "string" || far === articleId) continue;
      const docs = found.get(far);
      if (docs) docs.push(doc);
      else found.set(far, [doc]);
    }
  }
  return found;
}
