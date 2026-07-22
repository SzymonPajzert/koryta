import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import type { Article } from "~~/shared/model";
import { z } from "zod";

const articleRequestSchema = z.object({
  url: z.string(),
  name: z.string(),
  publishedDate: z.string().optional(),
  meta: z.any().optional(),
});

function parseDate(dateStr: string | undefined): Timestamp | undefined {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    console.error("Invalid date string:", dateStr);
    return undefined;
  }
  return Timestamp.fromDate(date);
}

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    articleRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const batch = db.batch();

  try {
    // Check if article with this URL already exists
    const existingSnap = await db
      .collection("nodes")
      .where("type", "==", "article")
      .where("sourceURL", "==", body.url)
      .limit(1)
      .get();

    let articleId: string;
    let created = false;

    if (!existingSnap.empty) {
      articleId = existingSnap.docs[0]!.id;
    } else {
      const articleRef = db.collection("nodes").doc();
      articleId = articleRef.id;

      const revisionData: Article = {
        name: body.name,
        type: "article",
        sourceURL: body.url,
        meta: body.meta,
        publishedDate: parseDate(body.publishedDate),
      };

      createRevisionTransaction(
        db,
        batch,
        user,
        articleRef,
        revisionData,
        false,
        // TODO don't autoapprove
        true,
        true,
      );
      created = true;
    }

    return {
      nodeId: articleId,
      created,
      status: "ok",
    };
  } finally {
    await batch.commit();
  }
});
