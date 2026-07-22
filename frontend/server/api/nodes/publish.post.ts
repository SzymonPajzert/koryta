import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { z } from "zod";

const bodyValidator = z.object({
  node_id: z.string(),
  published: z.boolean(),
});

/** Toggles the public visibility of a node. Publication is independent of
 * revision approval: a node needs an approved revision (`revision_id`) before
 * it can go live, but approving a newer revision never publishes a hidden
 * node on its own. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await getUser(event);
  if (user.admin !== true) {
    throw createError({
      statusCode: 403,
      message: "Tylko administrator może publikować strony.",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const nodeRef = db.collection("nodes").doc(body.node_id);
  const nodeDoc = await nodeRef.get();
  if (!nodeDoc.exists) {
    throw createError({
      statusCode: 404,
      message: `Node not found for id=${body.node_id}`,
    });
  }

  if (body.published && !nodeDoc.data()?.revision_id) {
    throw createError({
      statusCode: 400,
      message:
        "Nie można opublikować strony bez zatwierdzonej rewizji (revision_id).",
    });
  }

  await nodeRef.update({ published: body.published });
  console.info(
    `Set published=${body.published} on node=${body.node_id} by user=${user.uid}`,
  );

  return { id: body.node_id, published: body.published };
});
