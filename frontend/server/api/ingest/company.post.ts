import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import {
  companyRequestSchema,
  type CompanyRequest as Request,
} from "#shared/api";
import { categoriesFromActivity } from "#shared/companyCategories";
import { pageIsPublic, type EdgeType } from "#shared/model";
import { edgeDocumentId, findEdge } from "~~/server/utils/edges";
import { findRegionByTeryt } from "~~/server/utils/regions";

export default defineEventHandler(async (event) => {
  console.info("Handling ingest/company.post");
  const body: Request = await readValidatedBody(event, (body) =>
    companyRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const {
    ref: nodeRef,
    publish,
    stored,
  } = await findCompanyByKRS(db, body.krs, true);
  // Layered over what is already stored: a payload carries only the fields the
  // scrapers found, and the revision is written to the node wholesale. Taken
  // from the document the KRS lookup has already read, rather than asking for
  // it a second time.
  const revisionData: Record<string, unknown> = {
    ...withoutInternalFields(stored ?? {}),
    name: body.name,
    type: "place",
    krsNumber: body.krs,
  };
  if (body.activity && body.activity.length > 0) {
    revisionData.activity = body.activity;
    revisionData.categories = categoriesFromActivity(body.activity);
  }
  // A human answer wins. KRS cannot see who owns a spółka akcyjna, so the
  // scrapers' `false` is "no evidence" rather than "privately owned", and
  // re-running an ingest must not undo somebody who knew better.
  if (
    body.is_public !== undefined &&
    revisionData.isPublicSource !== "manual"
  ) {
    revisionData.isPublic = body.is_public;
  }

  const batch = db.batch();
  createRevisionTransaction(db, batch, user, nodeRef, revisionData, {
    automatic: true,
    approve: publish,
    stored,
    published: publish,
  });

  const dbb = { db, batch, user, added: new Set<string>() };

  // Process 'owns' relationships
  if (body.owners && Array.isArray(body.owners)) {
    for (const parent of body.owners) {
      if (!parent) continue;
      const { ref: parentRef } = await findCompanyByKRS(db, parent, false);
      await createEdge(dbb, parentRef.id, nodeRef.id, "owns", publish);
    }
  }

  // Process 'teryt' to link the company to a region
  let region: "added" | "existing" | "unknown" | undefined;
  if (body.teryt) {
    const regionNodeId = await findRegionByTeryt(db, body.teryt);
    if (regionNodeId) {
      const added = await createEdge(
        dbb,
        regionNodeId,
        nodeRef.id,
        "owns",
        publish,
      );
      region = added ? "added" : "existing";
    } else {
      // A company whose registered seat has no region node is still worth
      // ingesting for its other fields, so this is reported, not fatal.
      console.warn(
        `No region node for TERYT ${body.teryt} (krs=${body.krs}), skipping location`,
      );
      region = "unknown";
    }
  }

  await batch.commit();

  return { id: nodeRef.id, code: 200, region };
});

type DBB = {
  db: FirebaseFirestore.Firestore;
  batch: FirebaseFirestore.WriteBatch;
  user: { uid: string };
  /** Edge ids already added to this request's batch, so a payload listing the
   * same owner twice does not write the link - and a second revision of it -
   * twice over. A lookup cannot catch that: the batch is not committed yet. */
  added: Set<string>;
};

/** Links two nodes, at most once.
 *
 * The edge id is derived from what the edge represents, matching the scheme the
 * region pipeline already uses (`edge_<source>_<target>_<type>`), so re-running
 * an ingest cannot create a second copy of the same link. Edges written before
 * this carried random ids, so an existing link is looked up by its fields
 * rather than by id - an equality-only query, which Firestore serves by merging
 * single field indexes.
 *
 * Returns whether a new edge was added to the batch.
 */
async function createEdge(
  dbb: DBB,
  source: string,
  target: string,
  type: EdgeType,
  publish: boolean,
): Promise<boolean> {
  const { db, batch, user, added } = dbb;
  const edgeData = { source, target, type };

  const edgeId = edgeDocumentId(edgeData);
  if (added.has(edgeId)) {
    return false;
  }
  if (await findEdge(db, edgeData)) {
    return false;
  }
  added.add(edgeId);

  const edgeRef = db.collection("edges").doc(edgeId);
  // Only reached when no such edge exists, so there is nothing stored to carry.
  createRevisionTransaction(db, batch, user, edgeRef, edgeData, {
    automatic: true,
    approve: publish,
    published: publish,
  });
  return true;
}

/** Locate the company node for a KRS number.
 *
 * `publish` tells the caller whether the new revision should be approved and
 * published. To keep a migration safe, an existing company keeps its current
 * visibility: an already-public company stays public, while a still-pending
 * one is not force-published by a re-ingest. A brand-new company is published
 * as before.
 *
 * `stored` is the document as it is now, and is undefined for a company being
 * created. The caller needs it twice over - as the base the payload's fields
 * are layered onto, and as the state to carry through the `set` that writes the
 * revision - and this query has already read it, so returning it saves a second
 * read of every company in the pipeline. */
async function findCompanyByKRS(
  db: FirebaseFirestore.Firestore,
  krs: string,
  createNew: boolean,
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  publish: boolean;
  stored?: Record<string, unknown>;
}> {
  // Check if company already exists
  const existingQuery = await db
    .collection("nodes")
    .where("krsNumber", "==", krs)
    .limit(1)
    .get();

  if (!existingQuery.empty) {
    const doc = existingQuery.docs[0];
    if (!doc) {
      throw new Error("Unexpected empty docs array");
    }
    const stored = doc.data();
    return { ref: doc.ref, publish: pageIsPublic(stored), stored };
  } else if (createNew) {
    return { ref: db.collection("nodes").doc(), publish: true };
  } else {
    throw createError({
      statusCode: 404,
      message: `Company with KRS ${krs} not found`,
    });
  }
}

