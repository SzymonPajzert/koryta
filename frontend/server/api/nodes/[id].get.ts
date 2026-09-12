import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { nodeTypes, pageIsPublic } from "~~/shared/model";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { resolveMergedNode } from "~~/server/utils/merge";
import { z } from "zod";
import type { Node, Person } from "~~/shared/model";

const queryValidator = z.object({
  latest: z.string().optional(),
});

const responseValidator = z.object({
  name: z.string(),
  type: z.enum(nodeTypes),
  // TODO revision elements are either string or complex object
  revision_id: z.union([z.string(), z.object({ path: z.string() })]).optional(),
  published: z.boolean().optional(),
});

export default authCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Missing type or id" });
  }
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  const db = getFirestore(getApp(), "koryta-pl");
  const node = await (query.latest == "true"
    ? getLatestRevision(db, id)
    : getEntity(db, id));

  if (!node) {
    throw createError({
      statusCode: 404,
      message: `Node not found for id=${id} and latest=${query.latest}`,
    });
  }
  // TODO how to check the response has a correct shape
  const response: Node = responseValidator.parse(node);
  if (!pageIsPublic(response) && !query.latest) {
    throw createError({
      statusCode: 404,
      message: `Page ${id} is not approved`,
    });
  }

  return { node };
});

async function getLatestRevision(db: FirebaseFirestore.Firestore, id: string) {
  const [revisionSnapshot, stored] = await Promise.all([
    db
      .collection("revisions")
      .where("node_id", "==", id)
      .orderBy("update_time", "desc")
      .limit(1)
      .get(),
    getEntity(db, id),
  ]);
  const revisionDoc = revisionSnapshot.docs[0];
  // TODO get rid of this, each node should have a revision
  if (!revisionDoc) {
    return stored;
  }
  // `published` off the document, not the revision. A revision is what the page
  // should say; whether anybody may read it is the document's business, so
  // `INTERNAL_FIELDS` strips the flag on the way in and it is simply absent
  // here. Without this line every signed in reader - which is every reader who
  // reaches this branch, `authFetch` asking for `latest` on their behalf - was
  // handed `published: undefined` for a live page, and anything drawing a
  // "szkic" badge off it marked the whole site a draft.
  return {
    id,
    ...revisionDoc.data().data,
    published: stored?.published === true,
    // The same argument as `published`, for the two fields the badges are made
    // of. An aggregate belongs to the document - `stats.badges` is recounted by
    // the votes trigger from the `votes` collection, and `badgeModeration` is an
    // editor's verdict about the page - so `INTERNAL_FIELDS` strips both out of
    // revision data and neither is in `revisionDoc` to spread in.
    //
    // Without these two lines the badges would be invisible to precisely the
    // people who vote on them and to nobody else: `authFetch` puts
    // `latest: true` on every request a signed-in reader makes
    // (app/composables/auth.ts:181), so every signed-in reader arrives on this
    // branch, and `visibleBadges` needs the tallies to draw anything at all. A
    // proposal-state chip is shown *only* to signed-in readers, so it would
    // have had no audience whatsoever.
    //
    // Free: `stored` is the other half of the `Promise.all` above, already
    // fetched for `published`, so this adds no Firestore read.
    stats: stored?.stats,
    // Cast because `badgeModeration` is declared on `Person`, not on `PageBase`
    // - only people wear badges - while `getEntity` answers about any node type.
    // Reading it off a company simply yields `undefined`, which is what
    // `visibleBadges` treats as „nobody has ruled on anything”.
    badgeModeration: (stored as Person | undefined)?.badgeModeration,
  };
}

/** The page, or the page it was merged into.
 *
 * A duplicate keeps its document so its url still resolves, but it is
 * `deleted`, so answering with it would 404 every link anybody ever made to it
 * - which is the opposite of why it was kept. Answering with the survivor
 * instead costs nothing here and does the redirect for free: `[seoType]/[slug]`
 * already compares the url it was asked for against `generateNodeUrl` of what
 * this returns, and sends the reader to the difference.
 */
async function getEntity(db: FirebaseFirestore.Firestore, id: string) {
  const { snapshot: nodeDoc } = await resolveMergedNode(db, id);
  if (!nodeDoc?.exists) {
    return undefined;
  }
  const result = {
    id: nodeDoc.id,
    ...nodeDoc.data(),
  } as Node;
  if (result.revision_id) {
    if (typeof result.revision_id === "object") {
      result.revision_id = (result.revision_id as { path: string }).path;
    }
  }
  return result;
}
