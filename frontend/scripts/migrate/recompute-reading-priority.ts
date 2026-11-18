import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  cropPriority,
  readingPriority,
  readingReached,
} from "../../shared/declarations";
import { isPublicEmployment } from "../../shared/stats";
import type { Edge } from "../../shared/model";
import { reportRemaining } from "./remaining";

/**
 * One-time migration: recompute `priority` on every open crop (`cropPriority`
 * in shared/declarations.ts), now that the readers' queue puts the people the
 * automation could publish first.
 *
 * `priority` is what /api/declarations/next orders the queue by. It is
 * written by /api/ingest/declarations, from the person pages a crop names,
 * and moved by `requeueCrops` after a reading or an admin's decision. Until
 * 2026-11-04 it said only whether those pages were drafts and
 * whether they carried a birth date; a draft with no paid public post on it
 * now sits behind both (`readingPriority`), because the automation holds such
 * a page rather than publishing it (`no_public_post` in
 * server/utils/declarationPublish.ts).
 *
 * Crops already uploaded keep the number they were written with - the job
 * uploads incrementally and does not resend them - so without this the queue
 * goes on offering readers the people it offered yesterday. From here on the
 * ingest writes the new number itself.
 *
 * Since 2026-11-18 the number also says whether a reading has reached every
 * page the crop is for (`READ_PRIORITY`, the last tier), which on 2026-11-17
 * was true of 1,634 open crops, and moves a crop half a tier back where the
 * job read a full date off it that its page contradicts. A reading that
 * reaches a page moves that page's crops from then on (`requeueCrops` in
 * server/utils/readingQueue.ts); this moves the ones read before.
 *
 * Open crops only: `priority` orders the queue, which asks for
 * `status == "open"`, and a settled crop is never offered again. A crop whose
 * pages are all gone is reported and left alone; there is nothing to order it
 * by, and its number says what was true when it was uploaded.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/recompute-reading-priority.ts            # dry run
 *   npx tsx scripts/migrate/recompute-reading-priority.ts --commit   # apply
 * Against production, once production serves the code that writes the same
 * numbers (an older release would write the old ones over these):
 *   npx tsx scripts/migrate/recompute-reading-priority.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  // An array written through `sanitizeFirestoreData` comes back as an object
  // with numbered keys; see `asArray` in shared/model.ts.
  if (value && typeof value === "object") {
    return Object.values(value).filter((v) => typeof v === "string");
  }
  return [];
}

async function recompute() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  const crops = await db
    .collection("declarationExtracts")
    .where("status", "==", "open")
    .select("personIds", "priority", "machine.birthDate")
    .get();
  console.log(`Scanning ${crops.docs.length} open crop(s).`);

  // The pages a reading has reached: every page a settled crop was compared
  // with, as `requeueCrops` reads it page by page.
  const settled = await db
    .collection("declarationExtracts")
    .where("status", "==", "agreed")
    .select("status", "agreed.kind", "pageOutcomes")
    .get();
  const reached = new Set<string>();
  for (const doc of settled.docs) {
    const crop = doc.data();
    for (const id of Object.keys(crop.pageOutcomes ?? {})) {
      if (readingReached([crop], id)) reached.add(id);
    }
  }
  console.log(
    `${settled.docs.length} settled crop(s) have reached ${reached.size} page(s).`,
  );

  const pageIds = new Set<string>();
  for (const doc of crops.docs) {
    for (const id of asStrings(doc.get("personIds"))) pageIds.add(id);
  }
  console.log(`They name ${pageIds.size} person page(s).`);

  // The pages, then every employment edge of theirs, then the companies those
  // point at: the same three reads the ingest does, in one pass for all of
  // them rather than per crop.
  const pages = new Map<string, Record<string, unknown>>();
  const wanted = [...pageIds];
  for (let i = 0; i < wanted.length; i += 300) {
    const snapshots = await db.getAll(
      ...wanted.slice(i, i + 300).map((id) => db.collection("nodes").doc(id)),
    );
    for (const snapshot of snapshots) {
      const data = snapshot.data();
      // As `livePeople` reads them: a page that is gone, removed or not a
      // person orders nothing.
      if (data && data.type === "person" && data.deleted !== true) {
        pages.set(snapshot.id, data);
      }
    }
  }
  console.log(`${pages.size} of them are live person pages.`);

  const jobs: Edge[] = [];
  const drafts = [...pages.entries()]
    .filter(([, data]) => data.published !== true)
    .map(([id]) => id);
  for (let i = 0; i < drafts.length; i += 30) {
    const snapshot = await db
      .collection("edges")
      .where("source", "in", drafts.slice(i, i + 30))
      .where("type", "==", "employed")
      .get();
    for (const doc of snapshot.docs) {
      const data = doc.data() as Edge;
      if (data.deleted !== true) jobs.push(data);
    }
  }

  const companies = new Map<string, Record<string, unknown>>();
  const targets = [...new Set(jobs.map((job) => job.target).filter(Boolean))];
  for (let i = 0; i < targets.length; i += 300) {
    const snapshots = await db.getAll(
      ...targets.slice(i, i + 300).map((id) => db.collection("nodes").doc(id)),
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists) companies.set(snapshot.id, snapshot.data() ?? {});
    }
  }

  const withAPost = new Set<string>();
  for (const job of jobs) {
    if (isPublicEmployment(job, companies.get(job.target))) {
      withAPost.add(job.source);
    }
  }
  console.log(
    `${withAPost.size} of the ${drafts.length} draft page(s) have a paid ` +
      `public post on them.`,
  );

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  let unchanged = 0;
  let noPage = 0;
  const into = new Map<number, number>();

  for (const doc of crops.docs) {
    const mine = asStrings(doc.get("personIds")).filter((id) => pages.has(id));
    if (mine.length === 0) {
      noPage++;
      continue;
    }
    // As the ingest writes it.
    const next = cropPriority(
      mine.map((id) => ({
        tier: readingPriority(pages.get(id)!, withAPost.has(id)),
        read: reached.has(id),
        birthDate: pages.get(id)!.birthDate,
      })),
      doc.get("machine.birthDate"),
    );
    if (doc.get("priority") === next) {
      unchanged++;
      continue;
    }
    written++;
    into.set(next, (into.get(next) ?? 0) + 1);
    if (commit) {
      batch.update(doc.ref, { priority: next });
      pending++;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (commit && pending > 0) await batch.commit();

  const moved = [...into.entries()]
    .sort(([a], [b]) => a - b)
    .map(([priority, count]) => `${count} to ${priority}`)
    .join(", ");
  console.log(
    `${commit ? "Wrote" : "Would write"} priority on ${written} open ` +
      `crop(s)${moved ? ` (${moved})` : ""}; ${unchanged} already up to ` +
      `date; ${noPage} name no live person page and are left alone.`,
  );
  if (!commit) reportRemaining({ crops: written });
}

recompute()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
