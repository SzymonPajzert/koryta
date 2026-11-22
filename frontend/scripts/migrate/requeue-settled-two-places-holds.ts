import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { namesakeRunsOnPage } from "../../server/utils/declarationPublish";
import { PUBLICATIONS } from "../../server/utils/declarations";
import { reportRemaining } from "./remaining";

/**
 * Put back in the publication queue the drafts held for two places that the
 * place of their declarations settles (decision on 2026-11-22).
 *
 * A page whose candidacies stand in two places in one election was held for
 * an admin (`two_places`): 266 of them on 2026-11-22. Most carry a common
 * name, and PKW records are attached to everybody they fit, so a namesake's
 * runs sit beside the person's. `publishPage` in
 * server/utils/declarationPublish.ts now takes off the runs outside the place
 * of the declaration, where that place is the other side of every clash,
 * with the parties only they named, and publishes the page. Nothing asks a
 * hold again on its own, so this puts the pages held already back in the
 * queue, where the next passes take them up under the daily limit. 232 of the
 * 266 were such on that day's export.
 *
 * A draft whose clash is gone since, somebody having taken a run off by hand,
 * goes back too. The rest stay held: a clash with no side, or both sides, in
 * the place of the declaration, or a run elsewhere somebody reviewed. A page
 * an admin set aside (`declinedAt`) is left alone, and so is a page public by
 * now, whose hold a recheck closes.
 *
 * Safe to run again, and worth it after a change that can settle a hold - a
 * run taken off by hand, a crop read from another place - so it stays here
 * rather than in archive/.
 *
 * A record keeps its `queuedAt`, so it goes back where it first stood. Each is
 * put back in a transaction of its own, and only while it is still held as it
 * was read: an admin may publish or set it aside meanwhile.
 *
 * It reads the site's own code, so it runs through Nuxt's server tsconfig.
 * Against the running dev:prod-data emulator:
 *   npx tsx --tsconfig .nuxt/tsconfig.server.json \
 *     scripts/migrate/requeue-settled-two-places-holds.ts            # dry run
 *   ... scripts/migrate/requeue-settled-two-places-holds.ts --commit
 * Against production, once the release that settles them is live:
 *   ... scripts/migrate/requeue-settled-two-places-holds.ts --prod
 *   ... scripts/migrate/requeue-settled-two-places-holds.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

async function main() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  const holds = await db
    .collection(PUBLICATIONS)
    .where("status", "==", "held")
    .where("reason", "==", "two_places")
    .get();
  const open = holds.docs.filter((doc) => !doc.get("declinedAt"));

  const settled: { id: string; runs: string[] }[] = [];
  for (const doc of open) {
    const runs = await namesakeRunsOnPage(db, doc.id);
    if (runs) settled.push({ id: doc.id, runs });
  }
  const runs = settled.reduce((sum, page) => sum + page.runs.length, 0);
  console.log(
    `${holds.size} page(s) held for two places, ` +
      `${holds.size - open.length} of them set aside by an admin. ` +
      `${settled.length} the place of their declarations settles, ` +
      `with ${runs} namesake run(s) to take off: ` +
      `${commit ? "putting" : "would put"} them back in the queue. ` +
      `${open.length - settled.length} stay held.`,
  );
  for (const page of settled.slice(0, 10)) {
    console.log(`  ${page.id}  ${page.runs.length} run(s)`);
  }
  if (settled.length > 10) console.log(`  ... and ${settled.length - 10} more`);

  if (!commit) {
    reportRemaining({ pages: settled.length });
    return;
  }
  let requeued = 0;
  for (const page of settled) {
    const ref = db.collection(PUBLICATIONS).doc(page.id);
    const done = await db.runTransaction(async (tx) => {
      const record = (await tx.get(ref)).data();
      if (
        record?.status !== "held" ||
        record.reason !== "two_places" ||
        record.declinedAt
      ) {
        return false;
      }
      tx.update(ref, {
        status: "queued",
        reason: null,
        heldAt: FieldValue.delete(),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (done) requeued++;
  }
  console.log(
    `Put ${requeued} page(s) back in the queue` +
      (requeued < settled.length
        ? `; ${settled.length - requeued} changed meanwhile and were left.`
        : "."),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
