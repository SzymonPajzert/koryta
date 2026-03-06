import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const id = event.context.params?.id;

  if (!id) {
    throw createError({
      statusCode: 400,
      message: "Missing revision ID",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const revisionRef = db.collection("revisions").doc(id);
  const revisionSnap = await revisionRef.get();

  if (!revisionSnap.exists) {
    throw createError({
      statusCode: 404,
      message: "Revision not found",
    });
  }

  const revisionData = revisionSnap.data();

  if (!revisionData || !revisionData.node_id) {
    throw createError({
      statusCode: 500,
      message: "Invalid revision data",
    });
  }

  // check if user has permission to approve
  // for now, any logged in user can approve own revisions?
  // actually, let's allow any logged in user to approve for now as per "wiki" style
  // later we can add roles

  const nodeRef = db.collection("nodes").doc(revisionData.node_id);
  // check if node exists, if not check edges
  const nodeSnap = await nodeRef.get();
  let targetRef = nodeRef;

  if (!nodeSnap.exists) {
    const edgeRef = db.collection("edges").doc(revisionData.node_id);
    const edgeSnap = await edgeRef.get();
    if (edgeSnap.exists) {
      targetRef = edgeRef;
    } else {
      throw createError({
        statusCode: 404,
        message: "Target node/edge not found",
      });
    }
  }

  const batch = db.batch();

  // We are "applying" the revision.
  // This means we copy the data from revision to the node/edge
  // And we create a NEW revision that represents this change (so history is preserved)
  // Wait, if we are approving a pending revision, we should probably just update the node
  // and mark the revision as 'approved' or 'merged'?
  //
  // Koryta model seems to be: HEAD is in 'nodes'/'edges', history in 'revisions'.
  // When we edit, we create a revision.
  // If we approve, we update the HEAD.
  //
  // Let's see createRevisionTransaction. It creates a revision AND updates head if updateHead=true.
  //
  // Here we have an existing revision. We want to apply it to HEAD.
  // The user who approves is the one "making the change" effective.

  batch.update(targetRef, {
    ...revisionData.data,
    update_time: new Date(),
    update_user: user.uid,
    revision_id: id, // link to the revision that established this state
  });

  // Optional: mark revision as approved/merged?
  // currently model doesn't seem to have a status field on revision?
  // It seems purely based on whether it is referenced?
  // Let's just update the node.

  await batch.commit();

  return { status: "success", id };
});
