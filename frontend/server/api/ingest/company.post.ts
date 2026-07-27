import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import {
  baseNodeFields,
  createRevisionTransaction,
} from "~~/server/utils/revisions";
import {
  companyRequestSchema,
  type CompanyRequest as Request,
} from "#shared/api";
import { categoriesFromActivity } from "#shared/companyCategories";
import { pageIsPublic } from "#shared/model";

export default defineEventHandler(async (event) => {
  console.info("Handling ingest/company.post");
  const body: Request = await readValidatedBody(event, (body) =>
    companyRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const { ref: nodeRef, approve } = await findCompanyByKRS(db, body.krs, true);
  // Layered over what is already stored: a payload carries only the fields the
  // scrapers found, and the revision is written to the node wholesale.
  const revisionData: Record<string, unknown> = {
    ...(await baseNodeFields(nodeRef)),
    name: body.name,
    type: "place",
    krsNumber: body.krs,
  };
  if (body.activity && body.activity.length > 0) {
    revisionData.activity = body.activity;
    revisionData.categories = categoriesFromActivity(body.activity);
  }
  if (body.is_public !== undefined) {
    revisionData.isPublic = body.is_public;
  }

  const batch = db.batch();
  createRevisionTransaction(
    db,
    batch,
    user,
    nodeRef,
    revisionData,
    true,
    approve,
  );

  // Process 'owns' relationships
  if (body.owners && Array.isArray(body.owners)) {
    for (const parent of body.owners) {
      if (!parent) continue;
      const { ref: parentRef } = await findCompanyByKRS(db, parent, false);
      await createEdge(
        { db, batch, user },
        parentRef.id,
        nodeRef.id,
        "owns",
        approve,
      );
    }
  }

  // Process 'teryt' to link the company to a region
  let region: "added" | "existing" | "unknown" | undefined;
  if (body.teryt) {
    const regionNodeId = await findRegionByTeryt(db, body.teryt);
    if (regionNodeId) {
      const added = await createEdge(
        { db, batch, user },
        regionNodeId,
        nodeRef.id,
        "owns",
        approve,
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
};

/** Links two nodes, at most once.
 *
 * The edge id is derived from the triple it represents, matching the scheme the
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
  type: string,
  approve: boolean,
): Promise<boolean> {
  const { db, batch, user } = dbb;
  const edgeData = { source, target, type };

  const existing = await db
    .collection("edges")
    .where("source", "==", source)
    .where("target", "==", target)
    .where("type", "==", type)
    .limit(1)
    .get();
  if (!existing.empty) {
    return false;
  }

  const edgeRef = db
    .collection("edges")
    .doc(`edge_${source}_${target}_${type}`);
  createRevisionTransaction(db, batch, user, edgeRef, edgeData, true, approve);
  return true;
}

/** Locate the company node for a KRS number.
 *
 * `approve` tells the caller whether the new revision should be published
 * (become the node's current revision). To keep a migration safe, an existing
 * company keeps its current visibility: an already-public company stays public,
 * while a still-pending one is not force-published by a re-ingest. A brand-new
 * company is published as before. */
async function findCompanyByKRS(
  db: FirebaseFirestore.Firestore,
  krs: string,
  createNew: boolean,
): Promise<{ ref: FirebaseFirestore.DocumentReference; approve: boolean }> {
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
    return { ref: doc.ref, approve: pageIsPublic(doc.data()) };
  } else if (createNew) {
    return { ref: db.collection("nodes").doc(), approve: true };
  } else {
    throw createError({
      statusCode: 404,
      message: `Company with KRS ${krs} not found`,
    });
  }
}

/** Region node for a company's TERYT code, or null when there is none.
 *
 * Codes longer than a powiat are truncated to one, which is the level the
 * region nodes are complete at. Returns null rather than throwing so a bulk
 * ingest is not aborted by a single unmappable seat. */
async function findRegionByTeryt(
  db: FirebaseFirestore.Firestore,
  terytArg: string,
): Promise<string | null> {
  const teryt = terytArg.length > 4 ? terytArg.slice(0, 4) : terytArg;
  const regionNodeId = `teryt${teryt}`;
  const nodeWithTerytID = db.collection("nodes").doc(regionNodeId);
  if ((await nodeWithTerytID.get()).exists) {
    return regionNodeId;
  }

  const nodeWithTerytField = db
    .collection("nodes")
    .where("teryt", "==", teryt)
    .limit(1);
  const snapshot = await nodeWithTerytField.get();
  if (!snapshot.empty && snapshot.docs[0]) {
    return snapshot.docs[0].id;
  }

  return null;
}
