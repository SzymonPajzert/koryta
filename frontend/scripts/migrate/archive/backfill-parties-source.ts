import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { asArray } from "../../../shared/model";

/**
 * Pin the parties people stated before `partiesSource` existed.
 *
 * `/api/ingest/person` merges the parties a payload carries into the stored
 * list as a set union, so until 2026-09-11 a party a reviewer took off a page
 * came back with the next upload - and a coalition committee puts both of its
 * parties on everybody who ran for it, so a list somebody wrote as "PSL" reads
 * "PSL, Polska 2050" after one Trzecia Droga candidacy. Since then
 * `/api/revisions/create` stamps `partiesSource: "manual"` on any person
 * proposal that states `parties` - which the edit form always does - and the
 * ingest leaves a stamped list alone. Nothing stated before that carries the
 * stamp. Against the 2026-10-06 export, 11 published pages show a party the
 * person who wrote their list had left out, and 435 more lists a person wrote
 * are still open to the union - which the nightly now runs for real.
 *
 * So this stamps them, as if the rule had always been there. A person stated a
 * node's parties when a human revision that states them - not the pipeline's
 * (`update_automatic`), not a `migration:` author, not a removal - reached the
 * node, which it did if it is:
 *   - approved, or the revision the node points at now;
 *   - or the revision the node was created by. A page somebody adds is written
 *     with the proposal's data whether or not it is approved yet, and so was
 *     every page in the 2025-12-20 backfill of the hand-curated dataset that
 *     opens the revision log; neither carries a status saying so.
 * The latest of those is the person's word on the list, and per node:
 *   - the stored list is that list: stamp it.
 *   - the stored list is that list plus parties written after it by the
 *     pipeline or by a migration (the ingest's union, or
 *     `merge-duplicate-people.ts`'s, which carries a duplicate's parties the
 *     same way): put that list back and stamp it. That is what the stamp would
 *     have kept.
 *   - anything else is reported and left alone. A list missing a party the
 *     person stated, or one whose change no revision records, is not the union
 *     at work, and this does not guess what it is.
 *
 * Each change is filed as a revision, for the reason `apply-company-categories.ts`
 * gives: `partiesSource` is revision data rather than one of the node's own
 * fields, so a stamp written past the node's revision is lost the next time
 * anything is approved over it.
 *
 * Pending human proposals that state `parties` are stamped too, in their
 * `data`. Approving writes a revision's data over the node with `set`, so one
 * filed before the stamp existed would put its list on the page unpinned, and
 * the next upload would widen it again - the same reason `fix-stale-seats.ts`
 * corrects the revisions of an edge it moves. Decided revisions are history and
 * are left as they are, and so are the ones from before statuses were
 * recorded; see `proposalsToPin`.
 *
 * What it will not do:
 *   - touch a node already carrying the stamp. A person has answered since,
 *     and their list is the one that stands.
 *   - pin a list nobody stated. A node whose parties only ever came from the
 *     pipeline keeps taking the union.
 *   - publish or unpublish anything, or approve a draft: the node's revision
 *     pointer moves only if it already had one.
 *
 * Usage, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/archive/backfill-parties-source.ts     # dry run
 *   npx tsx scripts/migrate/archive/backfill-parties-source.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/archive/backfill-parties-source.ts --prod
 *   npx tsx scripts/migrate/archive/backfill-parties-source.ts --prod --commit
 */

const AUTHOR = "migration:backfill-parties-source";

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
  /** The list the revision states, or undefined when it does not state one. */
  parties?: string[];
  /** Its data already says `partiesSource: "manual"`. */
  pinned: boolean;
  /** A removal, which states the node's fields only because it copies them. */
  removal: boolean;
};

/** As much of a person node as deciding about it needs. */
export type NodeFacts = {
  parties: string[];
  pinned: boolean;
  /** Deleted, or folded into another page by a merge. */
  gone: boolean;
  /** The id of the revision the node points at, if it points at one. */
  revisionId?: string;
};

export type Decision =
  | { action: "pin" }
  | { action: "restore"; parties: string[] }
  | { action: "skip"; reason: string };

function isHuman(revision: RevisionFacts): boolean {
  return !revision.automatic && !revision.updateUser.startsWith("migration:");
}

/** A human revision that says what the person's parties are. */
function statesParties(revision: RevisionFacts): boolean {
  return isHuman(revision) && !revision.removal && !!revision.parties;
}

/** When a revision's data last reached the node, or undefined if it never has.
 *
 * The pipeline's and the migrations' revisions are written to the node as they
 * are filed, approved or not - `createRevisionTransaction` sets the target
 * whatever it is told about approval - and so is the revision that created the
 * node. A human's proposal otherwise waits for a reviewer. Approving writes a
 * revision's data again, so an approval after the filing is the later of the
 * two.
 */
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

function sameSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((v) => right.has(v));
}

/** Every member of `inner` is in `outer`, and `outer` has more. */
function strictlyWidens(outer: string[], inner: string[]): boolean {
  const held = new Set(outer);
  return (
    new Set(inner).size < held.size && inner.every((value) => held.has(value))
  );
}

/** What to do about one person node, or undefined when it is none of this
 * migration's business: already pinned, or its parties nobody ever stated. */
export function decide(
  node: NodeFacts,
  revisions: RevisionFacts[],
): Decision | undefined {
  if (node.pinned) return undefined;

  const ordered = [...revisions].sort((a, b) => a.updateTime - b.updateTime);
  const firstId = ordered[0]?.id;
  const reached = ordered
    .map((revision) => ({
      revision,
      at: appliedAt(revision, firstId, node),
    }))
    .filter(
      (entry): entry is { revision: RevisionFacts; at: number } =>
        entry.at !== undefined,
    )
    .sort((a, b) => a.at - b.at);

  const statements = reached.filter((entry) => statesParties(entry.revision));
  const stated = statements.at(-1);
  if (!stated) return undefined;

  if (node.gone) return { action: "skip", reason: "deleted or merged" };

  const theirs = stated.revision.parties!;
  if (sameSet(node.parties, theirs)) return { action: "pin" };

  if (!strictlyWidens(node.parties, theirs)) {
    return {
      action: "skip",
      reason: `stored [${node.parties.join(", ")}] is not [${theirs.join(", ")}] widened`,
    };
  }

  // An old human revision with no status that is neither the node's first nor
  // the one it points at may have been approved and then written over before
  // statuses were recorded, so it might be a later word on the list than the
  // one found above. Not knowing which, this leaves the list to a person.
  const unaccounted = ordered.some(
    (revision) =>
      statesParties(revision) &&
      revision.status === undefined &&
      revision.updateTime > stated.revision.updateTime &&
      appliedAt(revision, firstId, node) === undefined,
  );
  if (unaccounted) {
    return {
      action: "skip",
      reason: "a later human revision whose fate is not recorded",
    };
  }

  // The widening has to be on record: the last revision to reach the node
  // stating any list should be the one it holds now. Otherwise something wrote
  // the field directly, and putting the person's list back would undo that
  // without anybody having seen it.
  const lastWrite = reached.filter((entry) => !!entry.revision.parties).at(-1);
  if (!lastWrite || !sameSet(lastWrite.revision.parties!, node.parties)) {
    return {
      action: "skip",
      reason: "the stored list was written outside any revision",
    };
  }

  return { action: "restore", parties: [...theirs] };
}

/** The human proposals to stamp: waiting for a reviewer, stating a list, not
 * yet pinned.
 *
 * Waiting means stored as `pending`, which is what the review queue lists. A
 * revision with no status predates statuses, and not being pointed at does not
 * make it a proposal: it is usually the revision a page was created by, since
 * written over - and this migration repoints nodes itself, so reading it that
 * way would find more to stamp on every run.
 */
export function proposalsToPin(revisions: RevisionFacts[]): string[] {
  return revisions
    .filter(
      (revision) =>
        statesParties(revision) &&
        !revision.pinned &&
        revision.status === "pending",
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
  "data.parties",
  "data.partiesSource",
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
    parties:
      data.parties === undefined
        ? undefined
        : asArray<string>(data.parties as string[]),
    pinned: data.partiesSource === "manual",
    removal: data.deleted === true,
  };
}

function nodeFacts(data: Record<string, unknown>): NodeFacts {
  return {
    parties: asArray<string>(data.parties as string[]),
    pinned: data.partiesSource === "manual",
    gone: data.deleted === true || !!data.merged_into,
    revisionId: revisionIdOf(data.revision_id),
  };
}

function listed(parties: string[]): string {
  return `[${parties.join(", ")}]`;
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

  const pins: { doc: QueryDocumentSnapshot; restore?: string[] }[] = [];
  const skipped: string[] = [];
  const proposals: QueryDocumentSnapshot[] = [];
  let alreadyPinned = 0;

  for (const doc of people.docs) {
    const data = doc.data();
    const node = nodeFacts(data);
    const docs = revisionsByNode.get(doc.id) ?? [];
    const facts = docs.map(revisionFacts);
    if (node.pinned) alreadyPinned++;

    const pending = new Set(proposalsToPin(facts));
    proposals.push(...docs.filter((revision) => pending.has(revision.id)));

    const decision = decide(node, facts);
    if (!decision) continue;
    if (decision.action === "skip") {
      skipped.push(`  ${doc.id}  ${data.name}: ${decision.reason}`);
    } else {
      pins.push({
        doc,
        restore: decision.action === "restore" ? decision.parties : undefined,
      });
    }
  }

  const restores = pins.filter((pin) => pin.restore);
  console.log(`\nPutting back the list a person stated (${restores.length}):`);
  for (const { doc, restore } of restores) {
    const data = doc.data();
    console.log(
      `  ${doc.id}  ${data.name}${data.published === true ? "" : " (unpublished)"}: ` +
        `${listed(asArray<string>(data.parties))} -> ${listed(restore!)}`,
    );
  }
  if (skipped.length > 0) {
    console.log(`\nLeft alone (${skipped.length}):`);
    skipped.forEach((line) => console.log(line));
  }

  console.log("");
  console.log(`  already pinned:                   ${alreadyPinned}`);
  console.log(`  to pin as the person stated it:   ${pins.length}`);
  console.log(`    of which put back first:        ${restores.length}`);
  console.log(`  left alone:                       ${skipped.length}`);
  console.log(`  pending proposals to stamp:       ${proposals.length}`);
  console.log(
    "  (measured on the 2026-10-06 export: 446 to pin, 11 put back, " +
      "2 left alone, 143 proposals)",
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
  // that node's update time - so stamping a proposal first would trip the
  // precondition below on the node it belongs to.
  for (const { doc, restore } of pins) {
    const data = doc.data();
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }
    revisionData.partiesSource = "manual";
    if (restore) revisionData.parties = restore;

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
    const update: Record<string, unknown> = { partiesSource: "manual" };
    if (restore) update.parties = restore;
    if (approved) update.revision_id = revisionRef;
    batch.update(doc.ref, update, { lastUpdateTime: doc.updateTime });
    await flush(2);
  }

  for (const doc of proposals) {
    batch.update(
      doc.ref,
      { "data.partiesSource": "manual" },
      { lastUpdateTime: doc.updateTime },
    );
    await flush(1);
  }

  if (pending > 0) await batch.commit();

  console.log(
    `\nPinned ${pins.length} people (${restores.length} put back first) and ` +
      `stamped ${proposals.length} pending proposals.`,
  );
  console.log("Re-run the dry run: it must report nothing left to do.");
}

// Importable by the tests, which check the decision without Firestore. Same
// guard as `seed-public-institutions.ts`.
if (process.argv[1]?.endsWith("backfill-parties-source.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
