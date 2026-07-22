import { getFirestore } from "firebase-admin/firestore";

/** One-off backfill for the `published` field.
 *
 * Historically a page was public iff its `revision_id` was set. Visibility is
 * now controlled by the explicit `published` boolean, with `revision_id` only
 * marking the approved revision. This endpoint writes `published` onto every
 * node and edge that does not have it yet, using the legacy rule
 * (`published = !!revision_id`), so `pageIsPublic` no longer needs its
 * fallback. Idempotent: documents that already carry `published` are skipped.
 */
export default defineEventHandler(async () => {
  // TODO enable check here
  // await getUser(event);

  const db = getFirestore("koryta-pl");

  const results: Record<string, { migrated: number; skipped: number }> = {};

  for (const collection of ["nodes", "edges"] as const) {
    const snap = await db.collection(collection).get();

    let migrated = 0;
    let skipped = 0;
    const commits = [];
    let batch = db.batch();
    let operationCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.published !== undefined) {
        skipped++;
        continue;
      }

      batch.update(doc.ref, { published: !!data.revision_id });
      migrated++;
      operationCount++;

      if (operationCount === 400) {
        commits.push(batch.commit());
        batch = db.batch();
        operationCount = 0;
      }
    }

    if (operationCount > 0) {
      commits.push(batch.commit());
    }
    await Promise.all(commits);

    results[collection] = { migrated, skipped };
  }

  return { status: "success", ...results };
});
