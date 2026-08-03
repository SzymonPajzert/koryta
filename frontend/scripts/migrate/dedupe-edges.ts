import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  adminProjectFromEnv,
  firestoreDatabaseFromEnv,
} from "../../shared/firebase-env";
import {
  edgeIdentity,
  edgeSemantics,
  type EdgeLike,
} from "../../server/utils/edges";

/**
 * One-time migration: delete the edges that are genuinely a second copy of one
 * fact, and only those.
 *
 * The person ingest used to look an edge up by `(source, target)` alone, and to
 * do it with a query — which cannot see the writes still sitting in the
 * request's uncommitted batch. So a payload carrying several ties between the
 * same pair wrote one edge per tie and found none of them, leaving copies
 * behind. That is fixed in server/utils/edges.ts.
 *
 * What counts as a copy depends on what the edge type asserts, and getting this
 * wrong in the deleting direction destroys facts:
 *
 *   state (owns, mentions, comment, source) — the pair IS the assertion. A
 *     region either seats a company or it does not. A second copy says nothing
 *     new, so it goes.
 *
 *   occurrence (employed, election) — one bounded episode, and a person can
 *     have several between the same pair. `employed` is safe to collapse when
 *     the role and start date are both known, because the KRS pipeline derives
 *     start as a minimum over one connection set, so two rows agreeing on them
 *     describe one spell; a real second spell has a different start, which is
 *     what "employed there again after a break" means. `election` is NOT safe
 *     at any level of agreement: the office, the committee and the run-off
 *     round are all destroyed upstream, so a burmistrz bid and a rada bid in
 *     one town in 2024 are byte-identical, and so is one mayoral bid that went
 *     to a second round. Nothing stored separates them, so they are reported
 *     and left alone.
 *
 *   authored (connection, and any type this codebase does not know) — a person
 *     wrote it. Two notes about one pair are two notes. Never touched.
 *
 * Deleted edges take their revisions with them: a revision of an edge that
 * should never have existed is not history worth keeping, and leaving it would
 * orphan it.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/dedupe-edges.ts            # dry run
 *   npx tsx scripts/migrate/dedupe-edges.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/dedupe-edges.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: adminProjectFromEnv() });

/** How much this copy knows, for choosing which one to keep. */
function informativeness(doc: FirebaseFirestore.QueryDocumentSnapshot): number {
  const data = doc.data();
  return Object.entries(data).filter(
    ([key, value]) =>
      key !== "revision_id" &&
      value !== null &&
      value !== undefined &&
      value !== "",
  ).length;
}

/** The copy to keep: published if the group has any, then whichever knows most.
 *
 * Published comes first because `revision_id` is what makes an edge visible to
 * a logged out visitor, so keeping an unpublished copy would take a link off
 * the site.
 *
 * Informativeness matters because collapsing on the start of a spell brings
 * together copies that are not byte-identical: the same employment recorded
 * once while it was still running and again once its end date was known. The
 * copy carrying the end date is the one to keep - discarding it would leave a
 * finished job looking current, which is exactly the error this collapse
 * exists to fix. The id tie-break is arbitrary but stable, which is what lets a
 * dry run predict what the real run will do.
 */
function pickSurvivor(group: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const published = group.filter((doc) => doc.data().revision_id);
  const candidates = published.length > 0 ? published : group;
  return candidates.reduce((best, doc) => {
    const diff = informativeness(doc) - informativeness(best);
    if (diff !== 0) return diff > 0 ? doc : best;
    return doc.id < best.id ? doc : best;
  });
}

/** Whether a group of identical edges may be collapsed into one document.
 *
 * For an occurrence type this asks more than "do the fields agree": the fields
 * that pin the episode down have to be *there*. Two employments with no dates
 * at all agree trivially, and agreeing on nothing is not evidence of being the
 * same spell.
 */
function mayCollapse(edge: EdgeLike): { ok: boolean; reason: string } {
  const { kind, discriminators, identicalMeansSame } = edgeSemantics(edge.type);

  if (kind === "state") {
    return { ok: true, reason: "the pair is the whole assertion" };
  }
  if (!identicalMeansSame) {
    return {
      ok: false,
      reason: "identical fields do not prove one fact for this type",
    };
  }
  const missing = discriminators.filter(
    (name) => (edge as Record<string, unknown>)[name] == null,
  );
  if (missing.length > 0) {
    return { ok: false, reason: `no ${missing.join("/")} to identify it by` };
  }
  return { ok: true, reason: "the episode is fully identified and equal" };
}

/** The document id a revision's `node_id` points at, whichever way it is stored. */
function revisionTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value.split("/").pop();
  if (value && typeof value === "object" && "id" in value) {
    return (value as { id: string }).id;
  }
  return undefined;
}

async function migrate() {
  const db = getFirestore(app, firestoreDatabaseFromEnv());
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const edgesSnap = await db.collection("edges").get();
  console.log(`Scanning ${edgesSnap.docs.length} edges.`);

  const groups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const doc of edgesSnap.docs) {
    const identity = edgeIdentity(doc.data() as EdgeLike);
    const group = groups.get(identity);
    if (group) group.push(doc);
    else groups.set(identity, [doc]);
  }

  const redundant = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  const collapsing: Record<string, number> = {};
  const kept: Record<string, { groups: number; copies: number; why: string }> =
    {};

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0]!.data() as EdgeLike;
    const type = String(first.type);
    const { ok, reason } = mayCollapse(first);

    if (!ok) {
      const entry = (kept[type] ??= { groups: 0, copies: 0, why: reason });
      entry.groups++;
      entry.copies += group.length - 1;
      continue;
    }

    const survivor = pickSurvivor(group);
    for (const doc of group) {
      if (doc.id === survivor.id) continue;
      redundant.set(doc.id, doc);
      collapsing[type] = (collapsing[type] ?? 0) + 1;
    }
  }

  console.log(
    `  ${redundant.size} redundant edge(s) to delete: ` +
      (Object.entries(collapsing)
        .map(([type, count]) => `${type} ${count}`)
        .join(", ") || "none"),
  );
  for (const [type, entry] of Object.entries(kept)) {
    console.log(
      `  kept: ${entry.copies} extra ${type} edge(s) across ${entry.groups} ` +
        `group(s) — ${entry.why}`,
    );
  }

  // Revisions of an edge that is going away. Read after the edges so the set of
  // doomed ids is complete.
  const revisionsSnap = await db.collection("revisions").get();
  const orphanRevisions = revisionsSnap.docs.filter((doc) => {
    const target = revisionTarget(doc.data().node_id);
    return target !== undefined && redundant.has(target);
  });
  console.log(
    `  ${orphanRevisions.length} revision(s) belong to those edges and go with them.`,
  );

  if (commit) {
    let batch = db.batch();
    let pending = 0;
    for (const doc of [...redundant.values(), ...orphanRevisions]) {
      batch.delete(doc.ref);
      pending++;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();
  }

  console.log(
    `${commit ? "Deleted" : "Would delete"} ${redundant.size} edge(s) and ` +
      `${orphanRevisions.length} revision(s).`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
