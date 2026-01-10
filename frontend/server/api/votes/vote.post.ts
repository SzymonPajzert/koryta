import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import type { VoteCategory } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const body = await readBody(event);
  const { id, type, vote, category } = body as {
    id: string;
    type: "node" | "edge";
    vote: number;
    category: VoteCategory;
  };

  if (!id || !category || typeof vote !== "number") {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields",
      data: { id, type, vote, category },
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const collectionName = type === "edge" ? "edges" : "nodes";
  const docRef = db.collection(collectionName).doc(id);

  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw createError({
          statusCode: 404,
          statusMessage: "Entity not found",
        });
      }

      const data = doc.data() || {};
      if (!data.votes) data.votes = {};
      if (!data.votes[category]) data.votes[category] = { total: 0 };

      const oldUserVote = data.votes[category][user.uid] || 0;

      data.votes[category].total = (data.votes[category].total || 0) + vote;
      data.votes[category][user.uid] = oldUserVote + vote;
      t.update(docRef, { votes: data.votes });
    });

    return { success: true };
  } catch (error: unknown) {
    console.error("Vote error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    throw createError({
      statusCode: 500,
      statusMessage: "Internal Server Error",
      data: message,
    });
  }
});
