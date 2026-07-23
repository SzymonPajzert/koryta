import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
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
  const revisionData: Record<string, unknown> = {
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
      createEdge(
        { db, batch, user },
        parentRef.id,
        nodeRef.id,
        "owns",
        approve,
      );
    }
  }

  // Process 'teryt' to link the company to a region
  if (body.teryt) {
    const regionNodeId = await findRegionByTeryt(db, body.teryt);
    createEdge({ db, batch, user }, regionNodeId, nodeRef.id, "owns", approve);
  }

  await batch.commit();

  return { id: nodeRef.id, code: 200 };
});

type DBB = {
  db: FirebaseFirestore.Firestore;
  batch: FirebaseFirestore.WriteBatch;
  user: { uid: string };
};

function createEdge(
  dbb: DBB,
  source: string,
  target: string,
  type: string,
  approve: boolean,
) {
  const { db, batch, user } = dbb;
  const edgeRef = db.collection("edges").doc();
  const edgeData = {
    source,
    target,
    type,
  };

  createRevisionTransaction(db, batch, user, edgeRef, edgeData, true, approve);
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

async function findRegionByTeryt(
  db: FirebaseFirestore.Firestore,
  terytArg: string,
): Promise<string> {
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

  throw createError({
    statusCode: 400,
    message: `Region with TERYT code ${teryt} not found`,
  });
}
