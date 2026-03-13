import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import {
  companyRequestSchema,
  type CompanyRequest as Request,
} from "#shared/api";

export default defineEventHandler(async (event) => {
  console.info("Handling ingest/company.post");
  const body: Request = await readValidatedBody(event, (body) =>
    companyRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const nodeRef = await findCompanyByKRS(db, body.krs, true);
  const revisionData = {
    name: body.name,
    type: "place",
    krsNumber: body.krs,
  };

  const batch = db.batch();
  batch.set(nodeRef, revisionData, { merge: true });
  createRevisionTransaction(db, batch, user, nodeRef, revisionData);

  // Process 'owns' relationships
  if (body.owners && Array.isArray(body.owners)) {
    for (const parent of body.owners) {
      if (!parent) continue;
      const parentRef = await findCompanyByKRS(db, parent, false);
      createEdge({ db, batch, user }, parentRef.id, nodeRef.id, "owns");
    }
  }

  // Process 'teryt' to link the company to a region
  if (body.teryt) {
    const regionNodeId = await findRegionByTeryt(db, body.teryt);
    createEdge({ db, batch, user }, regionNodeId, nodeRef.id, "owns");
  }

  await batch.commit();

  return { id: nodeRef.id, code: 200 };
});

type DBB = {
  db: FirebaseFirestore.Firestore;
  batch: FirebaseFirestore.WriteBatch;
  user: { uid: string };
};

function createEdge(dbb: DBB, source: string, target: string, type: string) {
  const { db, batch, user } = dbb;
  const edgeRef = db.collection("edges").doc();
  const edgeData = {
    source,
    target,
    type,
  };

  batch.set(edgeRef, edgeData);
  createRevisionTransaction(db, batch, user, edgeRef, edgeData);
}

async function findCompanyByKRS(
  db: FirebaseFirestore.Firestore,
  krs: string,
  createNew: boolean,
) {
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
    return doc.ref;
  } else if (createNew) {
    return db.collection("nodes").doc();
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
