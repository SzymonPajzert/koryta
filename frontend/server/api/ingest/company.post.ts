import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.krs || !body.name) {
    throw createError({
      statusCode: 400,
      message: "Missing required fields (krs, name)",
    });
  }

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  // Check if company already exists
  const existingQuery = await db
    .collection("nodes")
    // this is not necessary
    // .where("type", "==", "place")
    .where("krsNumber", "==", body.krs)
    .limit(1)
    .get();

  let nodeRef;
  let currentData: any = {};

  if (!existingQuery.empty) {
    const doc = existingQuery.docs[0];
    if (!doc) {
      throw new Error("Unexpected empty docs array");
    }
    nodeRef = doc.ref;
    currentData = doc.data();
  } else {
    nodeRef = db.collection("nodes").doc();
  }

  // Preserve existing content if not provided in update
  const newContent =
    body.content !== undefined ? body.content : currentData.content || "";

  const revisionData = {
    name: body.name,
    type: "place",
    krsNumber: body.krs,
    content: newContent,
  };

  const batch = db.batch();
  createRevisionTransaction(db, batch, user, nodeRef, revisionData);

  // Process 'owns' relationships
  if (body.owns && Array.isArray(body.owns)) {
    for (const childKrs of body.owns) {
      if (!childKrs) continue;

      // Find child node
      const childQuery = await db
        .collection("nodes")
        .where("krsNumber", "==", childKrs)
        .limit(1)
        .get();

      let childRef;
      const firstDoc = childQuery.docs[0];
      if (!childQuery.empty && firstDoc) {
        childRef = firstDoc.ref;
      } else {
        childRef = db.collection("nodes").doc();
        const childData = {
          // TODO have a better way to add placeholders
          name: "Unknown Company",
          type: "place",
          krsNumber: childKrs,
          content: "",
        };
        createRevisionTransaction(db, batch, user, childRef, childData);
      }

      // Create 'owns' edge
      const edgeId = `edge_${nodeRef.id}_${childRef.id}_owns`;
      const edgeRef = db.collection("edges").doc(edgeId);
      const edgeData = {
        source: nodeRef.id,
        target: childRef.id,
        type: "owns",
      };
      createRevisionTransaction(db, batch, user, edgeRef, edgeData);
    }
  }

  await batch.commit();

  return { id: nodeRef.id, code: existingQuery.empty ? 201 : 200 };
});
