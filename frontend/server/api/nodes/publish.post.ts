import { getFirestore } from "firebase-admin/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { recordAudit } from "~~/server/utils/audit";
import { cascadeUnpublishEdges } from "~~/server/utils/edgePublication";
import { applyRevision } from "~~/server/utils/revisions";
import { notifyRevisionReviewed } from "~~/server/utils/revisionNotifications";
import { latestPublishableRevision } from "~~/shared/revisions";
import type { Revision } from "~~/shared/model";
import { z } from "zod";

const bodyValidator = z.object({
  node_id: z.string(),
  published: z.boolean(),
});

/** The revision a page goes live with when nobody has picked one.
 *
 * Most pages have never had a revision approved by hand - the ingests write
 * their snapshot and move on - so the reviewer who opened one and clicked
 * "Opublikuj" was met with a refusal and no way forward from that screen.
 * What they mean by publishing is "show what this page says now", and what it
 * says now is its newest revision, so that is the one approved on their
 * behalf. Which one that is, `latestPublishableRevision` decides, because the
 * button has to be able to name it before the click.
 */
async function latestApplicableRevision(
  db: Firestore,
  nodeId: string,
): Promise<{ ref: DocumentReference; revision: Revision } | null> {
  // Both spellings, the same way `/api/revisions/byNode` reads them: which one
  // a revision carries depends on which writer created it. Ordering happens in
  // memory rather than in the query - `update_time` is a Timestamp on some
  // rows and an ISO string on others, which no single index sorts correctly,
  // and a node's revisions number in the tens.
  const [byUnderscore, byCamel] = await Promise.all([
    db.collection("revisions").where("node_id", "==", nodeId).get(),
    db.collection("revisions").where("nodeId", "==", nodeId).get(),
  ]);

  const candidates = new Map<string, Revision & { id: string }>();
  for (const doc of [...byUnderscore.docs, ...byCamel.docs]) {
    if (candidates.has(doc.id)) continue;
    candidates.set(doc.id, {
      ...(doc.data() as Partial<Revision>),
      id: doc.id,
    } as Revision & { id: string });
  }

  const newest = latestPublishableRevision(Array.from(candidates.values()));
  if (!newest) return null;

  return {
    ref: db.collection("revisions").doc(newest.id),
    revision: newest,
  };
}

/** Toggles the public visibility of a node. Publication is independent of
 * revision approval: a node needs an approved revision (`revision_id`) before
 * it can go live - and where it has none, publishing approves its newest
 * revision to get one - but approving a newer revision never publishes a
 * hidden node on its own. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const nodeRef = db.collection("nodes").doc(body.node_id);
  const nodeDoc = await nodeRef.get();
  if (!nodeDoc.exists) {
    throw createError({
      statusCode: 404,
      message: `Node not found for id=${body.node_id}`,
    });
  }

  // Approved on the way up, not refused: see `latestApplicableRevision`. It is
  // its own commit, before the one below, so a page can never end up published
  // pointing at nothing - the worst case is a page approved but still hidden,
  // which is where every unpublished page already sits.
  let approvedRevision: { ref: DocumentReference; revision: Revision } | null =
    null;
  if (body.published && !nodeDoc.data()?.revision_id) {
    approvedRevision = await latestApplicableRevision(db, body.node_id);
    if (!approvedRevision) {
      throw createError({
        statusCode: 400,
        message:
          "Nie można opublikować strony: nie ma żadnej rewizji, którą dałoby się zatwierdzić.",
      });
    }
    await applyRevision(
      db,
      approvedRevision.ref,
      approvedRevision.revision,
      user,
    );
  }

  // Hiding the page hides the relations that lean on it, and in that order: no
  // edge may be published unless both its ends are, so taking the edges down
  // first means the invariant holds at every point in between. Nothing a
  // reader sees changes either way - the graph already drops an edge whose
  // node was filtered out - but the flag would otherwise outlive the page, and
  // republishing it later would bring back relations nobody looked at again.
  const hiddenEdges = body.published
    ? []
    : await cascadeUnpublishEdges(db, body.node_id, user);

  // The node keeps only the answer, so without this nothing said who gave it
  // or when - the one decision that settles what the public sees was the one
  // decision leaving no trace.
  const batch = db.batch();
  batch.update(nodeRef, { published: body.published });
  recordAudit(
    db,
    {
      action: body.published ? "publish" : "unpublish",
      collection: "nodes",
      target_id: body.node_id,
      user: user.uid,
    },
    batch,
  );
  await batch.commit();

  // Every cached page that counts this node - the explore endpoints, the stats
  // ones - answers from before it was visible until its own maxAge runs out.
  // /api/edges/publish and /api/revisions/approve have always done this; this
  // endpoint never did, so publishing a page with no relations ticked left the
  // whole site six hours behind with nothing to nudge it. Only reaches this
  // container's copy: anything Cloud CDN is holding is governed by the
  // `s-maxage` the cached handler sent, which is why the endpoints a reviewer
  // needs fresh are `editorFresh` as well.
  await useStorage("cache").clear("nitro:handlers");

  // After the commit, and never allowed to fail it: the same order and the
  // same reasoning as `/api/revisions/approve`, whose notification this is.
  // Somebody whose suggestion went live this way is owed the message as much
  // as one whose was approved from the queue.
  if (approvedRevision) {
    await notifyRevisionReviewed(db, {
      decision: "approved",
      revisionId: approvedRevision.ref.id,
      revision: approvedRevision.revision,
      targetRef: nodeRef,
      published: true,
      reviewerUid: user.uid,
      siteUrl: useRuntimeConfig(event).public.siteUrl,
    });
  }

  return {
    id: body.node_id,
    published: body.published,
    /** The relations hidden along with it, so the admin page can say so. */
    hiddenEdges,
    /** The revision approved to make this publication possible, where the page
     * had none - the admin page says which version it just put in front of
     * readers, since nobody chose it. */
    approvedRevisionId: approvedRevision?.ref.id ?? null,
  };
});
