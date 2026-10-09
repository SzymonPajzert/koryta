import { initializeApp } from "firebase-admin/app";
import {
  FieldPath,
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { Revision } from "../../shared/model";
import { approvedRevisionId, revisionCollection } from "../../shared/model";
import {
  holdsRevision,
  withoutInternalFields,
  sameStoredValue,
} from "../../server/utils/revisions";
import {
  edgeRevisionsForMany,
  publishCandidateRevision,
} from "../../server/utils/edgePublication";

/**
 * Undo the approvals that publishing an edge gave to proposals it never
 * applied.
 *
 * Until the fix to `publishCandidateRevision` (server/utils/edgePublication.ts),
 * publishing an edge with no `revision_id` pointed it at its newest un-rejected
 * revision and marked that approved, writing nothing else to the edge. When the
 * newest revision was a proposal - the pipeline's committee for a candidacy, or
 * a contributor's correction - it was marked approved without a word of it
 * reaching the edge. Measured over every daily export from 08-24 to 10-06,
 * all 32 edge proposals ever marked approved got it that way (30 committees,
 * 2 corrections by contributor 7bu9zrX4...), and one more came on 10-07. Each
 * left the review queue as if decided, while the site never showed it.
 *
 * Then the night made it worse: the people import found the edge still
 * without its committee, proposed it again, and `proposeRevisionTransaction`'s
 * `set` put the proposal back to pending and deleted its review fields - with
 * the edge still pointing at it. That is fixed in server/utils/revisions.ts,
 * and with it a proposal a reviewer has answered is never restated, so any
 * approval still faked when that ships would stay faked for good. Hence this.
 *
 * Two repairs, both on edges and both about proposals - the revisions filed
 * at a `proposal_<edge>_...` address, which only ever propose and never write
 * the edge themselves:
 *
 * 1. A proposal marked approved, or carrying review fields, that its edge does
 *    not hold (`holdsRevision`: the edge does not say exactly what it says) is
 *    set back to pending with `review_user`, `review_time` and
 *    `reject_reason` removed. It goes back to /admin/rewizje#powiazania, where
 *    approving it applies it for the first time and rejecting it now sticks.
 * 2. An edge whose `revision_id` names a proposal it does not hold is pointed
 *    at the revision `publishCandidateRevision` picks - the newest un-rejected
 *    one it does hold, which is what publishing it would have picked had the
 *    rule been right - or, where it holds none, at nothing. A revision picked
 *    that is still pending is approved on the way, as publishing approves it,
 *    by this migration.
 *
 * What it will not do:
 *   - publish or hide anything. `published` is the whole of visibility
 *     (`pageIsPublic`); `revision_id` is not read by it.
 *   - touch a rejected proposal, or one its edge holds - that one was applied.
 *   - touch a revision that is not a proposal. An edge pointing at an ordinary
 *     revision it no longer holds was written by that revision once, and that
 *     is not this bug: 207 on the 10-09 export, 146 holding "" or nothing
 *     where the revision has null and 60 with an end moved by a merge.
 *
 * Expected on the 2026-10-09 02:00 export: 21 proposals back to pending, 32
 * edges re-pointed and 1 pointer removed (proposal_TQ3Z..., whose edge names
 * a person merged away since and so holds none of its revisions). Of the 21,
 * eight were reset to pending by the night of 10-09 itself, review fields and
 * all, so production should read 13 / 32 / 1. The list as of 10-06 is in
 * ~/.cache/koryta/proposal-resets-2026-10-06/unapplied-proposals.csv.
 *
 * Run it only after both fixes are live, or publishing fakes more approvals
 * and the night resets them.
 *
 * Usage, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/repair-unapplied-proposal-approvals.ts           # dry run
 *   npx tsx scripts/migrate/repair-unapplied-proposal-approvals.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/repair-unapplied-proposal-approvals.ts --prod
 *   npx tsx scripts/migrate/repair-unapplied-proposal-approvals.ts --prod --commit
 */

const AUTHOR = "migration:repair-unapplied-proposal-approvals";

/** The address `proposeRevisionTransaction` files every proposal under. */
const PROPOSAL_PREFIX = "proposal_";

type RevisionDoc = Revision & { id: string };

/** Whether a proposal has to go back to pending.
 *
 * Marked approved, or carrying a reviewer's fields, while its edge does not
 * say what it says. A rejection stands whatever the edge holds: rejecting is
 * a verdict on the proposal, and needs nothing written to the edge.
 */
export function reopens(proposal: RevisionDoc, edge: Record<string, unknown>) {
  if (proposal.status === "rejected") return false;
  const reviewed =
    proposal.status === "approved" ||
    proposal.review_user !== undefined ||
    proposal.review_time !== undefined;
  return reviewed && !holdsRevision(edge, proposal.data);
}

/** Where an edge's pointer has to go, if it names a proposal the edge does not
 * hold: the revision publishing would pick now, or nothing. Undefined when the
 * pointer is not this script's business. */
export function repointing(
  edge: Record<string, unknown>,
  /** Every revision of the edge, newest first. */
  revisions: RevisionDoc[],
): { from: string; to: RevisionDoc | undefined } | undefined {
  const from = approvedRevisionId(edge.revision_id);
  if (!from?.startsWith(PROPOSAL_PREFIX)) return undefined;
  const pointed = revisions.find((revision) => revision.id === from);
  if (pointed && holdsRevision(edge, pointed.data)) return undefined;
  return { from, to: publishCandidateRevision(revisions, edge) };
}

/** The fields an edge would have to change to say what a revision says. */
function unapplied(edge: Record<string, unknown>, data: unknown): string[] {
  const stated = withoutInternalFields((data ?? {}) as Record<string, unknown>);
  const stands = withoutInternalFields(edge);
  return [...new Set([...Object.keys(stated), ...Object.keys(stands)])]
    .filter((key) => !sameStoredValue(stated[key], stands[key]))
    .sort()
    .map((key) =>
      key in stated
        ? `${key}=${JSON.stringify(stated[key])}`
        : `${key} removed`,
    );
}

function when(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return value === undefined ? "?" : String(value);
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }

  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  // Every proposal, by address: a few hundred documents rather than the whole
  // revisions collection. "`" is the character after "_".
  const proposalSnap = await db
    .collection("revisions")
    .where(FieldPath.documentId(), ">=", PROPOSAL_PREFIX)
    .where(FieldPath.documentId(), "<", "proposal`")
    .get();
  const proposals = proposalSnap.docs.filter(
    (doc) => revisionCollection(doc.data()) === "edges",
  );

  const edgeIds = [
    ...new Set(proposals.map((doc) => String(doc.data().node_id))),
  ];
  const edges = new Map<string, DocumentSnapshot>();
  for (let i = 0; i < edgeIds.length; i += 100) {
    const refs = edgeIds
      .slice(i, i + 100)
      .map((id) => db.collection("edges").doc(id));
    for (const snap of await db.getAll(...refs)) {
      if (snap.exists) edges.set(snap.id, snap);
    }
  }
  console.log(
    `Read ${proposals.length} edge proposals and the ${edges.size} edges ` +
      `they are about (${edgeIds.length - edges.size} more no longer exist).`,
  );

  // 1. Proposals marked approved that their edge does not hold.
  const reopened: QueryDocumentSnapshot[] = [];
  for (const doc of proposals) {
    const edge = edges.get(String(doc.data().node_id));
    if (!edge) continue;
    if (reopens({ id: doc.id, ...doc.data() } as RevisionDoc, edge.data()!)) {
      reopened.push(doc);
    }
  }

  // 2. Edges pointing at a proposal they do not hold. Their revisions are read
  //    only for these, to find the one each does hold.
  const suspect = [...edges.values()].filter((edge) =>
    approvedRevisionId(edge.data()!.revision_id)?.startsWith(PROPOSAL_PREFIX),
  );
  const revisions = await edgeRevisionsForMany(
    db,
    suspect.map((edge) => edge.id),
  );
  const pointers: {
    edge: DocumentSnapshot;
    from: string;
    to: RevisionDoc | undefined;
  }[] = [];
  for (const edge of suspect) {
    const repair = repointing(edge.data()!, revisions.get(edge.id) ?? []);
    if (repair) pointers.push({ edge, ...repair });
  }

  const published = (edge: DocumentSnapshot | undefined) =>
    edge?.data()?.published === true ? "published" : "draft";

  console.log(
    `\nMarked approved without being applied, back to pending (${reopened.length}):`,
  );
  for (const doc of reopened) {
    const data = doc.data();
    const edge = edges.get(String(data.node_id));
    console.log(
      `  ${doc.id}  ${data.update_automatic === true ? "pipeline" : `by ${data.update_user}`}, ` +
        `${data.status ?? "no status"} by ${data.review_user ?? "?"} at ${when(data.review_time)}; ` +
        `edge ${published(edge)}, lacks: ${unapplied(edge!.data()!, data.data).join("; ")}`,
    );
  }

  console.log(
    `\nEdges pointing at a proposal they do not hold (${pointers.length}):`,
  );
  for (const { edge, from, to } of pointers) {
    const target = to
      ? `${to.id} (${to.status ?? "no status"}${to.status === "pending" ? ", approved on the way" : ""})`
      : `nothing - holds none of its ${(revisions.get(edge.id) ?? []).length} revisions`;
    console.log(`  ${edge.id} (${published(edge)})  ${from} -> ${target}`);
  }

  const moved = pointers.filter((pointer) => pointer.to);
  const approvedOnTheWay = moved.filter(
    (pointer) => pointer.to!.status === "pending",
  );
  console.log("");
  console.log(`  proposals back to pending:            ${reopened.length}`);
  console.log(`  edge pointers moved:                  ${moved.length}`);
  console.log(
    `    onto a revision approved on the way: ${approvedOnTheWay.length}`,
  );
  console.log(
    `  edge pointers removed:                ${pointers.length - moved.length}`,
  );
  console.log(
    "  (on the 2026-10-09 02:00 export: 21, 32, 0, 1 - production after the " +
      "night of 10-09: 13, 32, 0, 1)",
  );

  if (!commit) {
    console.log("\nDry run. Re-run with --commit to apply.");
    return;
  }

  // Conditional on each document being as it was read, so a reviewer acting
  // in between fails the run instead of having the verdict undone. Re-running
  // picks up from what is there then.
  let batch = db.batch();
  let pending = 0;
  const flush = async (writes: number) => {
    pending += writes;
    if (pending < 400) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  for (const doc of reopened) {
    batch.update(
      doc.ref,
      {
        status: "pending",
        review_user: FieldValue.delete(),
        review_time: FieldValue.delete(),
        reject_reason: FieldValue.delete(),
      },
      { lastUpdateTime: doc.updateTime },
    );
    await flush(1);
  }

  for (const { edge, to } of pointers) {
    batch.update(
      edge.ref,
      {
        revision_id: to
          ? db.collection("revisions").doc(to.id)
          : FieldValue.delete(),
      },
      { lastUpdateTime: edge.updateTime! },
    );
    if (to?.status === "pending") {
      batch.update(db.collection("revisions").doc(to.id), {
        status: "approved",
        review_user: AUTHOR,
        review_time: Timestamp.now(),
      });
    }
    await flush(to?.status === "pending" ? 2 : 1);
  }

  if (pending > 0) await batch.commit();

  console.log(
    `\nReopened ${reopened.length} proposals, moved ${moved.length} edge ` +
      `pointers and removed ${pointers.length - moved.length}.`,
  );
  console.log("Re-run the dry run: it must report nothing left to do.");
}

// Importable by the tests, which check the two decisions without Firestore.
// Same guard as `backfill-parties-source.ts`.
if (process.argv[1]?.endsWith("repair-unapplied-proposal-approvals.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
