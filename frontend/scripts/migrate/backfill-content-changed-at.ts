import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pageIsPublic } from "../../shared/model";
import { normalizeUpdateTime } from "../../shared/revisions";
import { CONTENT_CHANGED_AT } from "../../shared/lastmod";

/**
 * One-time migration: give every node the date the write paths were not there
 * for.
 *
 * From the deploy onwards `content_changed_at` is written by the paths that
 * change a page - /api/nodes/publish for the page itself, and the trigger in
 * functions/src/edges.ts for the relations at either end of it. Neither can
 * know about a change that happened before they existed, and the sitemap's
 * `<lastmod>` falls back to `revisions.latest_time` for those, which is honest
 * about the node and blind to its relations.
 *
 * That blindness is the whole point of the field, so this reconstructs the
 * missing half from the best evidence already stored. Per node, the newest of:
 *
 *  - `update_time` / `review_time` of the node's own revisions;
 *  - the same, on the revisions of every relation that is *currently* published
 *    and not deleted, at either end of it.
 *
 * Measured on the export of 2026-09-18: 2,932 of the 6,802 sitemap pages - 43%
 * - are dated by a published relation rather than by their own revisions, so
 * without this run that many pages start out advertising a date older than the
 * last thing that actually changed on them.
 *
 * "Currently published" and not "published at the time", because a revision
 * records what an edge said, never whether it was live - `published` is a flag
 * on the edge that the next decision overwrites. Taking the current state means
 * a relation published long after it was written is dated by the write rather
 * than by the publication, which is too early; that errs towards an older date,
 * which costs a recrawl rather than the trust an over-fresh date costs.
 *
 * Rejected and pending revisions are skipped for the same reason `sitemapLastmod`
 * drops `latest_time` when `has_unapproved` is true: neither was ever visible.
 *
 * Dry run by default, so re-running it later is also the drift check - a
 * non-empty "would write" list once the field has been live means a node writer
 * that bypassed /api/nodes/publish, or a sweep that is not draining.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-content-changed-at.ts            # dry run
 *   npx tsx scripts/migrate/backfill-content-changed-at.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-content-changed-at.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** The later of two ISO instants, either of which may be missing. */
function newer(a: string | undefined, b: string | undefined) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

async function backfill() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // Which relation belongs to which pages, and whether a reader can see it.
  // Four fields of each edge: the document itself carries the claim's prose,
  // and there are ~50,000 of them.
  const edgesSnap = await db
    .collection("edges")
    .select("source", "target", "published", "deleted")
    .get();
  const endpointsByEdge = new Map<string, string[]>();
  // Every edge id, published or not. A revision carries its target's id in
  // `node_id` whatever collection that target lives in, so without this the
  // 20,078 revisions naming a relation nobody can see are indistinguishable
  // from the 26,334 naming a page, and each would be filed under an edge id
  // that the node loop below can never read back. Measured on the export of
  // 2026-09-18, that put 19,134 inert keys in `changedAt` and made the dry
  // run claim 32,200 dated nodes against a collection of 17,686.
  const edgeIds = new Set(edgesSnap.docs.map((doc) => doc.id));
  for (const doc of edgesSnap.docs) {
    if (
      !pageIsPublic({
        published: doc.get("published"),
        deleted: doc.get("deleted"),
      })
    ) {
      continue;
    }
    const ends = [doc.get("source"), doc.get("target")].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (ends.length > 0) endpointsByEdge.set(doc.id, [...new Set(ends)]);
  }
  console.log(
    `Loaded ${edgesSnap.docs.length} relation(s), ` +
      `${endpointsByEdge.size} of them published.`,
  );

  // Every revision, of a node or of an edge alike: edge revisions live in the
  // same collection, carrying the edge's id in `node_id` - the field is named
  // after the collection it was invented for, not after what it holds.
  const revisionsSnap = await db
    .collection("revisions")
    .select("node_id", "nodeId", "update_time", "review_time", "status")
    .get();

  const changedAt = new Map<string, string>();
  let fromOwn = 0;
  let fromRelation = 0;
  let fromDraftRelation = 0;

  for (const doc of revisionsSnap.docs) {
    if (doc.get("status") === "rejected" || doc.get("status") === "pending") {
      continue;
    }
    const targetId = (doc.get("node_id") ?? doc.get("nodeId")) as
      string | undefined;
    if (!targetId) continue;

    const at = newer(
      normalizeUpdateTime(doc.get("update_time")) ?? undefined,
      normalizeUpdateTime(doc.get("review_time")) ?? undefined,
    );
    if (!at) continue;

    // A revision names a node, a published edge, or a draft edge. Only the
    // first two date anything: a relation nobody could see never changed a
    // page, which is the same rule the trigger applies from here on.
    const pages = endpointsByEdge.get(targetId);
    if (pages) {
      fromRelation++;
      for (const nodeId of pages) {
        changedAt.set(nodeId, newer(changedAt.get(nodeId), at)!);
      }
    } else if (edgeIds.has(targetId)) {
      fromDraftRelation++;
    } else {
      fromOwn++;
      changedAt.set(targetId, newer(changedAt.get(targetId), at)!);
    }
  }
  console.log(
    `Read ${revisionsSnap.docs.length} revision(s): ${fromOwn} against a page, ` +
      `${fromRelation} against a published relation, ` +
      `${fromDraftRelation} against a relation nobody can see. ` +
      `${changedAt.size} node(s) have a date.`,
  );

  const nodesSnap = await db
    .collection("nodes")
    .select(CONTENT_CHANGED_AT)
    .get();
  console.log(`Scanning ${nodesSnap.docs.length} node(s).`);

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  let unchanged = 0;
  let noEvidence = 0;

  for (const doc of nodesSnap.docs) {
    const at = changedAt.get(doc.id);
    if (!at) {
      noEvidence++;
      continue;
    }
    // Never backwards. Anything already stored was written by a path that
    // watched the change happen, which is better evidence than this
    // reconstruction, and moving a date into the past would ask for a recrawl
    // of something that has since changed again.
    const current = doc.get(CONTENT_CHANGED_AT) as string | undefined;
    if (current && current >= at) {
      unchanged++;
      continue;
    }
    written++;
    if (commit) {
      batch.update(doc.ref, { [CONTENT_CHANGED_AT]: at });
      pending++;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(
    `${commit ? "Wrote" : "Would write"} ${CONTENT_CHANGED_AT} on ${written} ` +
      `node(s); ${unchanged} already at least that fresh; ` +
      `${noEvidence} have no approved revision at either end and keep falling ` +
      `back to revisions.latest_time in the sitemap.`,
  );
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
