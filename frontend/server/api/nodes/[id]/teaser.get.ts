import { getFirestore } from "firebase-admin/firestore";
import { getRouterParam } from "h3";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { resolveMergedNode } from "~~/server/utils/merge";
import { importedOrReviewed } from "~~/server/utils/provenance";
import {
  buildPersonTeaser,
  type PersonTeaser,
  type TeaserCompany,
  type TeaserEdge,
} from "~~/shared/personTeaser";

/** The few facts a logged out reader is shown of a person whose page they may
 * not open: the name and the most recent post. See `shared/personTeaser.ts`
 * for what it leaves out and why.
 *
 * Only what an import wrote or a reviewer approved (`importedOrReviewed`): a
 * person somebody proposed is a 404 here, as their page is, and a post somebody
 * added is not named or counted. Otherwise any person who has not been
 * removed, published or not. A published one has a page of its own and
 * nothing asks for this, but answering costs nothing and keeps a reader whose
 * copy of the page is a stale 404 from a second wall.
 *
 * The same answer for everybody, so one cache entry per person, cleared by
 * every write path as the others are. Nothing here reads the caller or the
 * `latest` flag: a draft's revisions, parties and candidacies are not on this
 * route for anybody.
 */
export default authCachedEventHandler(async (event): Promise<PersonTeaser> => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Missing id" });
  }

  const db = getFirestore("koryta-pl");
  // The survivor of a merge, as /api/nodes/[id] answers: a link to the
  // duplicate is a link to the person.
  const { id: personId, snapshot } = await resolveMergedNode(db, id);
  const person = snapshot?.data();
  if (
    !person ||
    person.type !== "person" ||
    person.deleted === true ||
    typeof person.name !== "string"
  ) {
    throw createError({ statusCode: 404, message: `No person ${id}` });
  }

  const stored = (
    await db
      .collection("edges")
      .where("source", "==", personId)
      .where("type", "==", "employed")
      .get()
  ).docs.map(
    (doc) =>
      ({ id: doc.id, ...doc.data() }) as TeaserEdge & { revision_id?: unknown },
  );

  const shown = await importedOrReviewed(db, [
    { id: personId, revision_id: person.revision_id },
    ...stored.filter((edge) => edge.deleted !== true),
  ]);
  if (!shown.has(personId)) {
    throw createError({ statusCode: 404, message: `No person ${id}` });
  }
  const edges = stored.filter((edge) => shown.has(edge.id));

  const companyIds = [...new Set(edges.map((edge) => edge.target))].filter(
    Boolean,
  );
  const companySnaps = companyIds.length
    ? await db.getAll(
        ...companyIds.map((companyId) => db.collection("nodes").doc(companyId)),
      )
    : [];
  const companies = new Map<string, TeaserCompany>();
  for (const snap of companySnaps) {
    const data = snap.data();
    if (!data) continue;
    companies.set(snap.id, {
      type: data.type,
      name: data.name,
      published: data.published,
      deleted: data.deleted,
      isPublic: data.isPublic,
      isPublicSource: data.isPublicSource,
      categories: data.categories,
      supervisoryBody: data.supervisoryBody,
    });
  }

  return buildPersonTeaser(
    { id: personId, name: person.name },
    edges,
    companies,
    Date.now(),
  );
});
