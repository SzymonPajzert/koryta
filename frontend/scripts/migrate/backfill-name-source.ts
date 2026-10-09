import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

/**
 * Pin the company names people gave before `nameSource` existed.
 *
 * `/api/ingest/company` writes the name a payload carries over whatever the
 * node holds, and the pipelines spell every name the way the register does:
 * in capitals, with the town where two companies share a name. So the next
 * company upload would put "STAWY MILICKIE (Ruda Sułowska)" over the "Stawy
 * Milickie" a person typed, and "POLSKIE LNG (Świnoujście)" over the "Polskie
 * LNG (wykreślone)" that says what the register no longer does. Since this
 * change the ingest leaves a name marked `nameSource: "manual"` alone, and
 * `/api/revisions/create` marks one when a proposal changes the name or
 * creates the page. Nothing named before that carries the mark.
 *
 * So this marks them, as if the rule had always been there. A person named a
 * place when a human revision - not the pipeline's (`update_automatic`), not
 * a `migration:` author, not a removal - reached the node and said a name
 * other than the one it had just before: the page's creation, or a rename. A
 * human revision reached the node if it is approved, the one the node points
 * at, or the one the node was created by - the reading `appliedAt` in
 * `backfill-parties-source.ts` takes, and this repeats. The last such name is
 * the person's, and per place:
 *   - the stored name is that name: mark it.
 *   - anything else is reported and left alone: the pipelines have renamed the
 *     page since, the register's spelling has stood there for a while, and
 *     putting the person's back is a decision rather than a repair.
 *
 * Measured against the 2026-10-09 export: 264 places carry a name a person
 * gave them, 110 of them still hold it - 109 pages a person created, among
 * them "Stawy Milickie" and "Pogotowie Ratunkowe w Legnicy", and one rename,
 * Polskie LNG's. 20 of the 110 have a KRS number, which is what an upload
 * finds a company by. The other 154 have been renamed by the pipelines since.
 *
 * Each mark is filed as a revision, for the reason `apply-company-categories.ts`
 * gives: `nameSource` is revision data rather than one of the node's own
 * fields, so a mark written past the node's revision is lost the next time
 * anything is approved over it.
 *
 * Pending human proposals are marked too, in their `data`, where approving one
 * would otherwise drop the mark or bring in an unmarked name: every proposal
 * on a place this marks, and every proposal that renames a place. Approving
 * writes a revision's data over the node with `set`.
 *
 * What it will not do:
 *   - touch a node already carrying the mark.
 *   - mark a name nobody gave: a place the pipelines created and named keeps
 *     taking the register's name, renames included.
 *   - publish or unpublish anything, or approve a draft: the node's revision
 *     pointer moves only if it already had one.
 *
 * Usage, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/backfill-name-source.ts            # dry run
 *   npx tsx scripts/migrate/backfill-name-source.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/backfill-name-source.ts --prod
 *   npx tsx scripts/migrate/backfill-name-source.ts --prod --commit
 */

const AUTHOR = "migration:backfill-name-source";

/** As much of a revision as deciding about it needs. */
export type RevisionFacts = {
  id: string;
  /** Milliseconds; `update_time`. */
  updateTime: number;
  /** Milliseconds; `review_time`, where it has one. */
  reviewTime?: number;
  automatic: boolean;
  updateUser: string;
  status?: string;
  /** The name the revision states, or undefined when it states none. */
  name?: string;
  /** Its data already says `nameSource: "manual"`. */
  pinned: boolean;
  /** A removal, which states the node's fields only because it copies them. */
  removal: boolean;
};

/** As much of a place node as deciding about it needs. */
export type NodeFacts = {
  name?: string;
  pinned: boolean;
  /** Deleted, or folded into another page by a merge. */
  gone: boolean;
  /** The id of the revision the node points at, if it points at one. */
  revisionId?: string;
};

export type Decision = { action: "pin" } | { action: "skip"; reason: string };

function isHuman(revision: RevisionFacts): boolean {
  return !revision.automatic && !revision.updateUser.startsWith("migration:");
}

/** When a revision's data last reached the node, or undefined if it never has.
 *
 * The pipeline's and the migrations' revisions are written to the node as they
 * are filed, approved or not, and so is the revision that created the node. A
 * human's proposal otherwise waits for a reviewer. The same reading
 * `backfill-parties-source.ts` takes. */
function appliedAt(
  revision: RevisionFacts,
  firstId: string | undefined,
  node: NodeFacts,
): number | undefined {
  const approved =
    revision.status === "approved" || revision.id === node.revisionId;
  const reviewed = approved
    ? (revision.reviewTime ?? revision.updateTime)
    : undefined;
  const writtenWhenFiled = revision.id === firstId || !isHuman(revision);
  if (!writtenWhenFiled) return reviewed;
  return Math.max(revision.updateTime, reviewed ?? revision.updateTime);
}

/** The name a person last gave the place, of the ones that reached it. */
export function nameAPersonGave(
  node: NodeFacts,
  revisions: RevisionFacts[],
): string | undefined {
  const ordered = [...revisions].sort((a, b) => a.updateTime - b.updateTime);
  const firstId = ordered[0]?.id;
  const reached = ordered
    .map((revision) => ({ revision, at: appliedAt(revision, firstId, node) }))
    .filter(
      (entry): entry is { revision: RevisionFacts; at: number } =>
        entry.at !== undefined,
    )
    .sort((a, b) => a.at - b.at);

  let previous: string | undefined;
  let given: string | undefined;
  for (const { revision } of reached) {
    if (revision.removal || revision.name === undefined) continue;
    if (isHuman(revision) && revision.name !== previous) given = revision.name;
    previous = revision.name;
  }
  return given;
}

/** What to do about one place, or undefined when it is none of this
 * migration's business: already marked, or named by nobody but the pipelines. */
export function decide(
  node: NodeFacts,
  revisions: RevisionFacts[],
): Decision | undefined {
  if (node.pinned) return undefined;
  const given = nameAPersonGave(node, revisions);
  if (given === undefined) return undefined;
  if (node.gone) return { action: "skip", reason: "deleted or merged" };
  if (node.name !== given) {
    return {
      action: "skip",
      reason: `renamed since: a person named it "${given}"`,
    };
  }
  return { action: "pin" };
}

/** The human proposals to mark: waiting for a reviewer, not yet marked, and
 * either on a place whose name is marked (or about to be), where approving an
 * unmarked snapshot would drop the mark, or renaming the place.
 *
 * Waiting means stored as `pending`, which is what the review queue lists - see
 * `proposalsToPin` in `backfill-parties-source.ts` for why a revision with no
 * status is not one. */
export function proposalsToPin(
  node: NodeFacts,
  revisions: RevisionFacts[],
  pinning: boolean,
): string[] {
  return revisions
    .filter(
      (revision) =>
        isHuman(revision) &&
        !revision.removal &&
        !revision.pinned &&
        revision.status === "pending" &&
        (pinning ||
          node.pinned ||
          (revision.name !== undefined && revision.name !== node.name)),
    )
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
  "update_time",
  "review_time",
  "update_user",
  "update_automatic",
  "status",
  "data.name",
  "data.nameSource",
  "data.deleted",
];

function millis(value: unknown): number | undefined {
  if (!value) return undefined;
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

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
    updateTime: millis(raw.update_time) ?? 0,
    reviewTime: millis(raw.review_time),
    automatic: raw.update_automatic === true,
    updateUser: String(raw.update_user ?? ""),
    status: typeof raw.status === "string" ? raw.status : undefined,
    name: typeof data.name === "string" ? data.name : undefined,
    pinned: data.nameSource === "manual",
    removal: data.deleted === true,
  };
}

function nodeFacts(data: Record<string, unknown>): NodeFacts {
  return {
    name: typeof data.name === "string" ? data.name : undefined,
    pinned: data.nameSource === "manual",
    gone: data.deleted === true || !!data.merged_into,
    revisionId: revisionIdOf(data.revision_id),
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

  const places = await db
    .collection("nodes")
    .where("type", "==", "place")
    .get();
  const placeIds = new Set(places.docs.map((doc) => doc.id));

  const revisionDocs = await db
    .collection("revisions")
    .select(...REVISION_FIELDS)
    .get();
  const revisionsByNode = new Map<string, QueryDocumentSnapshot[]>();
  for (const doc of revisionDocs.docs) {
    const raw = doc.data();
    if (raw.collection === "edges") continue;
    const nodeId = revisionIdOf(raw.node_id ?? raw.nodeId);
    if (!nodeId || !placeIds.has(nodeId)) continue;
    revisionsByNode.set(nodeId, [...(revisionsByNode.get(nodeId) ?? []), doc]);
  }
  console.log(
    `Read ${places.size} place nodes and ${revisionDocs.size} revisions.`,
  );

  const pins: QueryDocumentSnapshot[] = [];
  const skipped: string[] = [];
  const proposals: QueryDocumentSnapshot[] = [];
  let alreadyPinned = 0;

  for (const doc of places.docs) {
    const data = doc.data();
    const node = nodeFacts(data);
    const docs = revisionsByNode.get(doc.id) ?? [];
    const facts = docs.map(revisionFacts);
    if (node.pinned) alreadyPinned++;

    const decision = decide(node, facts);
    if (decision?.action === "skip") {
      skipped.push(`  ${doc.id}  ${data.name}: ${decision.reason}`);
    } else if (decision?.action === "pin") {
      pins.push(doc);
    }

    const pending = new Set(
      proposalsToPin(node, facts, decision?.action === "pin"),
    );
    proposals.push(...docs.filter((revision) => pending.has(revision.id)));
  }

  console.log(`\nMarking the name a person gave (${pins.length}):`);
  for (const doc of pins) {
    const data = doc.data();
    console.log(
      `  ${doc.id}  ${data.krsNumber ?? "(no KRS)"}  ${data.name}` +
        (data.published === true ? "" : " (unpublished)"),
    );
  }
  if (skipped.length > 0) {
    console.log(`\nLeft alone (${skipped.length}):`);
    skipped.forEach((line) => console.log(line));
  }

  console.log("");
  console.log(`  already marked:                 ${alreadyPinned}`);
  console.log(`  to mark as a person named it:   ${pins.length}`);
  console.log(
    `    of which with a KRS number:   ${pins.filter((doc) => doc.data().krsNumber).length}`,
  );
  console.log(`  left alone:                     ${skipped.length}`);
  console.log(`  pending proposals to mark:      ${proposals.length}`);
  console.log(
    "  (measured on the 2026-10-09 export: 110 to mark, 20 with a KRS " +
      "number, 154 left alone)",
  );

  if (!commit) {
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
  // that node's update time - so marking a proposal first would trip the
  // precondition below on the node it belongs to.
  for (const doc of pins) {
    const data = doc.data();
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }
    revisionData.nameSource = "manual";

    // Approved when the node already has an approved revision, the way the
    // ingest files a change to a page. A draft gets a pending one with the
    // change applied, which is also what the ingest does to a draft, so this
    // approves nothing a reviewer has not.
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

    // A targeted update, not the snapshot written back: the node's own fields
    // belong to other writers, and a `set` would drop what this does not carry.
    // Conditional on the node being as it was read, so an edit landing between
    // the read and this write fails the run instead of being answered by a
    // revision built from what came before it. A re-run picks up from there.
    const update: Record<string, unknown> = { nameSource: "manual" };
    if (approved) update.revision_id = revisionRef;
    batch.update(doc.ref, update, { lastUpdateTime: doc.updateTime });
    await flush(2);
  }

  for (const doc of proposals) {
    batch.update(
      doc.ref,
      { "data.nameSource": "manual" },
      { lastUpdateTime: doc.updateTime },
    );
    await flush(1);
  }

  if (pending > 0) await batch.commit();

  console.log(
    `\nMarked ${pins.length} names and ${proposals.length} pending proposals.`,
  );
  console.log("Re-run the dry run: it must report nothing left to do.");
}

// Importable by the tests, which check the decision without Firestore. Same
// guard as `seed-public-institutions.ts`.
if (process.argv[1]?.endsWith("backfill-name-source.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
