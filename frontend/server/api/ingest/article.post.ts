import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { ensureArticleNode } from "~~/server/utils/articles";
import { z } from "zod";

const articleRequestSchema = z.object({
  url: z.string(),
  name: z.string(),
  publishedDate: z.string().optional(),
  meta: z.any().optional(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    articleRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const batch = db.batch();

  try {
    const { nodeId, created } = await ensureArticleNode(db, batch, user, body);
    return { nodeId, created, status: "ok" };
  } finally {
    await batch.commit();
  }
});
