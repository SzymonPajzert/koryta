import { z } from "zod";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { imageField, newImage } from "~~/server/utils/images";

const bodyValidator = z.object({
  nodeId: z.string().regex(/^[^/]{1,200}$/),
  // Re-encoded in the browser - see shared/images.ts.
  image: imageField("person", "To nie jest zdjęcie, które przyjmujemy."),
});

/** Photos one contributor may upload in a day. Each is half a megabyte that
 * nobody but a reviewer sees until a proposal names it, so an upload that is
 * never proposed is kept for nothing; admins are not counted. */
const DAILY_UPLOADS_PER_USER = 20;

async function claimUpload(db: Firestore, uid: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection("imageLimits").doc(`${day}_${uid}`);
  return db.runTransaction(async (tx) => {
    const count = ((await tx.get(ref)).get("count") as number | undefined) ?? 0;
    if (count >= DAILY_UPLOADS_PER_USER) return false;
    tx.set(ref, { count: count + 1, day, uid }, { merge: true });
    return true;
  });
}

/** Takes a photo of a person, to be proposed as their `photo`.
 *
 * Uploading changes nothing on the page. The image is visible to admins alone
 * until a proposal naming it is approved and the page is published - see
 * `IMAGE_ACCESS` - so it goes through the same review as every other change a
 * contributor makes. The answer is what the proposal refers to it by.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const body = await readValidatedBody(event, (raw) =>
    bodyValidator.parse(raw),
  );

  const db = getFirestore("koryta-pl");
  const node = (await db.collection("nodes").doc(body.nodeId).get()).data();
  if (!node || node.type !== "person" || node.deleted === true) {
    throw createError({ statusCode: 404, message: "Nie ma takiej osoby." });
  }

  if (user.admin !== true && !(await claimUpload(db, user.uid))) {
    throw createError({
      statusCode: 429,
      message: "Na dziś to już wszystkie zdjęcia, jakie możesz dodać.",
    });
  }

  const created = newImage(db, body.image, {
    purpose: "person",
    subject: `nodes/${body.nodeId}`,
    uploadedBy: user.uid,
  });
  await created.ref.set(created.doc);

  return { image: created.imageRef };
});
