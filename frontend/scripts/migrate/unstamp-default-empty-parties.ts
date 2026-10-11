import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { asArray } from "../../shared/model";
import { reportRemaining } from "./remaining";

/**
 * Take `partiesSource: "manual"` off the empty party lists nobody stated.
 *
 * The mark says a person decided the list, so `/api/ingest/person` leaves it
 * alone instead of adding the parties PKW knows. But the edit form sends
 * `parties` for a person whatever was done with the select, and until
 * 2026-10-11 `/api/revisions/create` marked any proposal that carried it - so a
 * page added without touching the select was stored as `[]` marked as "in no
 * party", and so was one whose empty list was saved with only the birth date
 * changed. `backfill-parties-source.ts` did the same on 2026-10-06 to the older
 * pages, reading a page's creating revision as the person's word on the list.
 * On the 2026-10-09 evening export 85 live person pages carry a marked empty
 * list. 83 of them never had a party in any revision - 57 marked by the
 * backfill and 26 by the form, 79 created under Szymon's account, 39 of them
 * drafts - and the ingest has never added one to them. A merge that keeps a
 * marked list would also drop the parties of a pipeline page folded into one.
 *
 * Szymon's decision (2026-10-11, "Unstamp defaults"): take the mark off those,
 * and keep it where somebody emptied a list. The code fix is `statesParties` in
 * `server/api/revisions/create.post.ts`, which no longer marks an empty list
 * over an empty one, and `backfill-parties-source.ts` now reads a revision the
 * same way, so its dry run does not count these pages as lists to pin again.
 *
 * A person node is unmarked when it is marked, its list is empty, and no
 * revision of it - whoever filed it, approved or not - ever listed a party.
 * Anything with a party in its history is left alone and reported. The other
 * two on the 10-09 export each have a party in a revision from early 2026 (PO,
 * PiS) that their page does not show, filed before statuses were recorded, so
 * whether a reviewer turned it down or somebody took it off again is not
 * known, and a mark there may be somebody's answer.
 *
 * Each change is filed as a revision, for the reason `apply-company-categories.ts`
 * gives: `partiesSource` is revision data rather than one of the node's own
 * fields, so a node that drops it while its revision still says it no longer
 * says what its revision says. Approved and pointed at when the node already
 * points at an approved revision; a draft gets a pending one, the way
 * `backfill-parties-source.ts` filed the mark on them. The night's
 * `test_a_later_revision_never_drops_a_field` knows this author: the field
 * these revisions leave out is left out on purpose.
 *
 * Pending revisions that carry the mark lose it too, in their `data`, on the
 * pages this unmarks and on any other page whose list was never anything but
 * empty. Approving writes a revision's data over the node with `set`, so a
 * marked proposal would put the mark straight back: the page's own creating
 * proposal on a draft, the pending revisions the backfill filed on drafts, and
 * edits proposed under the old rule - 87 of them on the 10-09 export, 12 on
 * pages that were never marked. Decided revisions are history and stay as
 * they are.
 *
 * What it will not do:
 *   - touch a list with a party on it, or one that ever had one.
 *   - publish or unpublish anything, or approve a draft: the node's revision
 *     pointer moves only if it already had one.
 *
 * Usage, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/unstamp-default-empty-parties.ts           # dry run
 *   npx tsx scripts/migrate/unstamp-default-empty-parties.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/unstamp-default-empty-parties.ts --prod
 *   npx tsx scripts/migrate/unstamp-default-empty-parties.ts --prod --commit
 */

const AUTHOR = "migration:unstamp-default-empty-parties";

/** As much of a revision as deciding about it needs. */
export type RevisionFacts = {
  id: string;
  status?: string;
  /** The list the revision states, or undefined when it does not state one. */
  parties?: string[];
  /** Its data says `partiesSource: "manual"`. */
  pinned: boolean;
};

/** As much of a person node as deciding about it needs. */
export type NodeFacts = {
  parties: string[];
  pinned: boolean;
  /** Deleted, or folded into another page by a merge. */
  gone: boolean;
};

export type Decision = { action: "unpin" } | { action: "skip"; reason: string };

/** Whether the person's list has ever had a party on it: now, or in any
 * revision of the page. Any author and any status, since a list somebody
 * proposed and a reviewer has not answered yet is still a list somebody
 * stated - leaving the mark where that is so costs nothing but a party the
 * ingest might have added. */
export function everListedAParty(
  node: NodeFacts,
  revisions: RevisionFacts[],
): boolean {
  return (
    node.parties.length > 0 ||
    revisions.some((revision) => (revision.parties ?? []).length > 0)
  );
}

/** What to do about one person node, or undefined when it is none of this
 * migration's business: not marked, or marked over a list with a party. */
export function decide(
  node: NodeFacts,
  revisions: RevisionFacts[],
): Decision | undefined {
  if (!node.pinned || node.parties.length > 0) return undefined;
  if (node.gone) return { action: "skip", reason: "deleted or merged" };
  if (everListedAParty(node, revisions)) {
    return {
      action: "skip",
      reason: "a revision lists a party, so the list may have been emptied",
    };
  }
  return { action: "unpin" };
}

/** The pending revisions to unmark: waiting for a reviewer and carrying the
 * mark, on a page whose list was never anything but empty - whether the page
 * itself is marked (and about to lose it) or not.
 *
 * Waiting means stored as `pending`, which is what the review queue lists; see
 * `proposalsToPin` in `archive/backfill-parties-source.ts` for why a revision
 * with no status is not one. */
export function proposalsToUnpin(
  node: NodeFacts,
  revisions: RevisionFacts[],
): string[] {
  if (node.gone || everListedAParty(node, revisions)) return [];
  return revisions
    .filter((revision) => revision.pinned && revision.status === "pending")
    .map((revision) => revision.id);
}

/** Computed or bookkeeping fields that belong to the node rather than to any
 * revision, mirroring `INTERNAL_FIELDS` in `server/utils/revisions.ts`. Copied
 * rather than imported for the reason `apply-company-categories.ts` gives. */
const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "published",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "merged_into",
  "needs_split",
  "nameChunksLower",
]);

/** The fields a revision is read for. Read with a field mask: the collection
 * holds every revision of every node and edge, and only these are needed. */
const REVISION_FIELDS = [
  "node_id",
  "nodeId",
  "collection",
  "status",
  "data.parties",
  "data.partiesSource",
];

/** A revision pointer as an id, whichever way it was stored: a reference, as
 * the code writes it, or a path string, as some old documents carry it. */
function revisionIdOf(pointer: unknown): string | undefined {
  if (!pointer) return undefined;
  if (typeof pointer === "string") return pointer.split("/").at(-1);
  return (pointer as Partial<DocumentReference>).id;
}

function revisionFacts(doc: QueryDocumentSnapshot): RevisionFacts {
  const raw = doc.data();
  const data = (raw.data ?? {}) as Record<string, unknown>;
  return {
    id: doc.id,
    status: typeof raw.status === "string" ? raw.status : undefined,
    parties:
      data.parties === undefined
        ? undefined
        : asArray<string>(data.parties as string[]),
    pinned: data.partiesSource === "manual",
  };
}

function nodeFacts(data: Record<string, unknown>): NodeFacts {
  return {
    parties: asArray<string>(data.parties as string[]),
    pinned: data.partiesSource === "manual",
    gone: data.deleted === true || !!data.merged_into,
  };
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

  const people = await db
    .collection("nodes")
    .where("type", "==", "person")
    .get();
  const personIds = new Set(people.docs.map((doc) => doc.id));

  const revisionDocs = await db
    .collection("revisions")
    .select(...REVISION_FIELDS)
    .get();
  const revisionsByNode = new Map<string, QueryDocumentSnapshot[]>();
  for (const doc of revisionDocs.docs) {
    const raw = doc.data();
    if (raw.collection === "edges") continue;
    const nodeId = revisionIdOf(raw.node_id ?? raw.nodeId);
    if (!nodeId || !personIds.has(nodeId)) continue;
    revisionsByNode.set(nodeId, [...(revisionsByNode.get(nodeId) ?? []), doc]);
  }
  console.log(
    `Read ${people.size} person nodes and ${revisionDocs.size} revisions.`,
  );

  const unpins: QueryDocumentSnapshot[] = [];
  const skipped: string[] = [];
  const proposals: QueryDocumentSnapshot[] = [];
  let pinnedEmpty = 0;
  let onUnpinnedPages = 0;

  for (const doc of people.docs) {
    const data = doc.data();
    const node = nodeFacts(data);
    const docs = revisionsByNode.get(doc.id) ?? [];
    const facts = docs.map(revisionFacts);
    if (node.pinned && node.parties.length === 0) pinnedEmpty++;

    const decision = decide(node, facts);
    if (decision?.action === "skip") {
      skipped.push(`  ${doc.id}  ${data.name}: ${decision.reason}`);
    } else if (decision?.action === "unpin") {
      unpins.push(doc);
    }

    const pending = new Set(proposalsToUnpin(node, facts));
    if (!node.pinned) onUnpinnedPages += pending.size;
    proposals.push(...docs.filter((revision) => pending.has(revision.id)));
  }

  const drafts = unpins.filter((doc) => !doc.data().revision_id);
  console.log(`\nTaking the mark off (${unpins.length}):`);
  for (const doc of unpins) {
    const data = doc.data();
    console.log(
      `  ${doc.id}  ${data.name}` +
        (data.published === true ? "" : " (unpublished)") +
        (data.revision_id ? "" : " (draft)"),
    );
  }
  if (skipped.length > 0) {
    console.log(`\nLeft alone (${skipped.length}):`);
    skipped.forEach((line) => console.log(line));
  }

  console.log("");
  console.log(`  marked empty lists:                 ${pinnedEmpty}`);
  console.log(`  to unmark, never listed a party:    ${unpins.length}`);
  console.log(`    of which drafts:                  ${drafts.length}`);
  console.log(`  left alone:                         ${skipped.length}`);
  console.log(`  pending revisions to unmark:        ${proposals.length}`);
  console.log(`    of which on unmarked pages:       ${onUnpinnedPages}`);
  console.log(
    "  (measured on the 2026-10-09 evening export: 85 marked empty lists, " +
      "83 to unmark, 39 drafts, 2 left alone, 87 pending revisions, 12 on " +
      "unmarked pages)",
  );

  if (!commit) {
    reportRemaining({ unpins: unpins.length, proposals: proposals.length });
    console.log("\nDry run. Re-run with --commit to apply.");
    return;
  }

  let batch = db.batch();
  let pending = 0;
  const flush = async (writes: number) => {
    pending += writes;
    if (pending < 400) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  // The nodes before the proposals. Filing a revision makes
  // `onRevisionWritten` rewrite its node's `revisions` summary, which moves
  // that node's update time - so unmarking a proposal first would trip the
  // precondition below on the node it belongs to.
  for (const doc of unpins) {
    const data = doc.data();
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key) && key !== "partiesSource") {
        revisionData[key] = value;
      }
    }

    const approved = !!data.revision_id;
    const revisionRef = db.collection("revisions").doc();
    const now = Timestamp.now();
    batch.set(revisionRef, {
      node_id: doc.id,
      collection: "nodes",
      data: revisionData,
      update_time: now,
      update_user: AUTHOR,
      update_automatic: true,
      status: approved ? "approved" : "pending",
      ...(approved ? { review_user: AUTHOR, review_time: now } : {}),
    });

    // A targeted update, conditional on the node being as it was read, for
    // the reasons `backfill-parties-source.ts` gives. A re-run picks up from
    // wherever a failed one stopped.
    const update: Record<string, unknown> = {
      partiesSource: FieldValue.delete(),
    };
    if (approved) update.revision_id = revisionRef;
    batch.update(doc.ref, update, { lastUpdateTime: doc.updateTime });
    await flush(2);
  }

  for (const doc of proposals) {
    batch.update(
      doc.ref,
      { "data.partiesSource": FieldValue.delete() },
      { lastUpdateTime: doc.updateTime },
    );
    await flush(1);
  }

  if (pending > 0) await batch.commit();

  console.log(
    `\nUnmarked ${unpins.length} people (${drafts.length} drafts) and ` +
      `${proposals.length} pending revisions.`,
  );
  console.log("Re-run the dry run: it must report nothing left to do.");
}

// Importable by the tests, which check the decision without Firestore. Same
// guard as `seed-public-institutions.ts`.
if (process.argv[1]?.endsWith("unstamp-default-empty-parties.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
