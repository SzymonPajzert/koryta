import { Timestamp } from "firebase-admin/firestore";
import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import { edgeRelation, type EdgeLike } from "../../server/utils/edges";
import {
  createRevisionTransaction,
  sameStoredValue,
  withoutInternalFields,
} from "../../server/utils/revisions";
import { recordAudit } from "../../server/utils/audit";

/**
 * Folding one candidacy stored twice into a single edge: what the migrations
 * that find such runs share once they have decided which copies are one run.
 *
 * merge-national-runs-stored-twice.ts finds a Sejm, Senate or European run
 * stored under the candidate's home beside the copy in its district;
 * merge-local-runs-stored-twice.ts a local run stored as „Samorząd” beside the
 * copy that names its office. Which copies are one run is each script's own
 * question. Once answered, the run is folded the same way:
 *
 *   - the copy filed where the run belongs (`place`: the district's, the
 *     named one) stays, unless it is a draft and another copy is live - then
 *     the live copy stays, keeping its id and its history, moves to that place
 *     and learns what the copy there said;
 *   - the kept copy says everything the removed ones did, or the ingest's
 *     `preferredCopy` would take a removed copy asserting more for every later
 *     send of the run;
 *   - a draft kept is never taught anything: what a draft says is a reviewer's
 *     to approve, so such a run is left (`draft would learn`);
 *   - the others are removed as /api/edges/delete removes one, and a revision
 *     still waiting on one is rejected - the review queues list the revisions
 *     of a removed relation like any other's.
 */

/** One stored edge, as read. */
export type StoredEdge = { id: string; data: Record<string, unknown> };

/** What becomes of one run stored twice. */
export type RunPlan = {
  personId: string;
  office: string;
  startDate: string;
  /** Where the run belongs: the region of the copy the others fold into. */
  placeId: string;
  /** The copy that stays. */
  keep: string;
  /** Where the kept copy was filed before, when it moves; null when it is the
   * copy in place, staying put. */
  movedFrom: string | null;
  /** Whether the kept copy is live, which it stays. */
  published: boolean;
  /** What the kept copy says once the run is folded into it, or null when it
   * says that already and is not moving. */
  data: Record<string, unknown> | null;
  /** The fields the kept copy learns from the copies removed. */
  learns: Record<string, unknown>;
  /** The copies removed. */
  remove: string[];
};

/** A run a script found stored twice and left for a person, and why. */
export type SkippedRun = {
  reason: string;
  personId: string;
  office: string;
  startDate: string;
  ids: string[];
};

export function byId(a: StoredEdge, b: StoredEdge): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A field with nothing in it, as the edit form and the ingest write nothing:
 * `field` in server/utils/edges.ts, and an empty list as well. */
export function blank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** The fields no copy is folded over: which relation it is, and where. */
const PLACE_FIELDS = new Set(["source", "target", "type"]);

/** Whether two copies of a run say something different about one field each
 * of them fills in. `edgeRelation` answers it for the fields that say which
 * run it is and whether it was won; this covers the rest - a note or a source
 * a reviewer added to one copy is not dropped for the other's. `says` is what
 * `fold` takes: a value it reads as saying nothing does not disagree. */
export function disagree(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  says: (key: string, value: unknown) => boolean = () => true,
): boolean {
  if (
    edgeRelation(a as EdgeLike, b as EdgeLike) === "conflict" ||
    edgeRelation(b as EdgeLike, a as EdgeLike) === "conflict"
  ) {
    return true;
  }
  const left = withoutInternalFields(a);
  const right = withoutInternalFields(b);
  const telling = (key: string, value: unknown) =>
    !blank(value) && says(key, value);
  return Object.keys(left).some(
    (key) =>
      !PLACE_FIELDS.has(key) &&
      telling(key, left[key]) &&
      telling(key, right[key]) &&
      // The pipeline's committee in whatever case that year's file had is
      // the same committee; `edgeRelation` already compared it folded.
      key !== "committee" &&
      !sameStoredValue(left[key], right[key]),
  );
}

/** How one run folds: the copy kept and what it says after, the ones removed.
 * Or "draft would learn" where the kept copy is a draft that would have to be
 * taught something. */
export function fold(
  /** The copy filed where the run belongs. */
  place: StoredEdge,
  /** The copies that fold into it. */
  others: readonly StoredEdge[],
  options: {
    /** Whether a value says anything, beyond being filled in at all: for a
     * local run, an office of „Samorząd” does not, and the named one takes its
     * place. Every value does by default. */
    says?: (key: string, value: unknown) => boolean;
    /** Fields the copy in place never learns from the others, which say them
     * less reliably than it does. */
    ownedByPlace?: ReadonlySet<string>;
  } = {},
):
  | Pick<
      RunPlan,
      "keep" | "movedFrom" | "published" | "data" | "learns" | "remove"
    >
  | "draft would learn" {
  const says = options.says ?? (() => true);
  const liveOther = others.find((copy) => copy.data.published === true);
  const keep = place.data.published === true || !liveOther ? place : liveOther;

  const before = withoutInternalFields(keep.data);
  const after: Record<string, unknown> = {
    ...before,
    target: place.data.target,
  };
  const learns: Record<string, unknown> = {};
  for (const copy of [place, ...others]) {
    if (copy === keep) continue;
    for (const [key, value] of Object.entries(
      withoutInternalFields(copy.data),
    )) {
      if (PLACE_FIELDS.has(key) || blank(value) || !says(key, value)) continue;
      if (!blank(after[key]) && says(key, after[key])) continue;
      if (keep === place && options.ownedByPlace?.has(key)) continue;
      after[key] = value;
      learns[key] = value;
    }
  }
  const published = keep.data.published === true;
  if (!published && Object.keys(learns).length > 0) return "draft would learn";
  return {
    keep: keep.id,
    movedFrom: keep === place ? null : String(keep.data.target),
    published,
    data: sameStoredValue(after, before) ? null : after,
    learns,
    remove: [place, ...others]
      .filter((copy) => copy !== keep)
      .map((copy) => copy.id),
  };
}

/** The revisions written onto one edge. */
export async function revisionsOf(db: Firestore, edgeId: string) {
  return (await db.collection("revisions").where("node_id", "==", edgeId).get())
    .docs;
}

/** The plans that can be written, the ones held back and why, and the
 * revisions waiting on each copy to be removed.
 *
 * What only reading beyond the candidacies can tell: a revision waiting on
 * the live copy that moves (approving it would put the copy back), votes cast
 * on a copy that goes, a fact promoted into one. `extra` is a script's own
 * question about a plan, asked last. Each holds its run back rather than being
 * guessed at. */
export async function holdBack(
  db: Firestore,
  plans: readonly RunPlan[],
  stored: ReadonlyMap<string, Record<string, unknown>>,
  extra?: (plan: RunPlan) => Promise<string | undefined>,
): Promise<{
  ready: RunPlan[];
  held: { plan: RunPlan; why: string }[];
  pendingOnRemoved: Map<string, string[]>;
}> {
  const pendingOnRemoved = new Map<string, string[]>();
  const held: { plan: RunPlan; why: string }[] = [];
  const ready: RunPlan[] = [];
  for (const plan of plans) {
    let why: string | undefined;
    if (plan.movedFrom) {
      const waiting = (await revisionsOf(db, plan.keep)).filter(
        (doc) => doc.data().status === "pending",
      );
      if (waiting.length > 0) {
        why = `the copy that moves holds ${waiting.length} revision(s) waiting for review`;
      }
    }
    for (const id of plan.remove) {
      if (why) break;
      const votes = stored.get(id)?.votes;
      if (votes && Object.keys(votes).length > 0) {
        why = `${id} carries votes`;
        break;
      }
      const promoted = await db
        .collection("extractions")
        .where("promotedEdgeIds", "array-contains", id)
        .limit(1)
        .get();
      if (!promoted.empty) {
        why = `a fact was promoted into ${id}`;
        break;
      }
      pendingOnRemoved.set(
        id,
        (await revisionsOf(db, id))
          .filter((doc) => doc.data().status === "pending")
          .map((doc) => doc.id),
      );
    }
    if (!why && extra) why = await extra(plan);
    if (why) held.push({ plan, why });
    else ready.push(plan);
  }
  return { ready, held, pendingOnRemoved };
}

/** Prints what a run will do and what it leaves, the same way for every
 * script. `names` and `places` name a person and a region by id. */
export function printPlans(
  plans: readonly RunPlan[],
  ready: readonly RunPlan[],
  held: readonly { plan: RunPlan; why: string }[],
  skipped: readonly SkippedRun[],
  pendingOnRemoved: ReadonlyMap<string, string[]>,
  names: ReadonlyMap<string, string>,
  places: ReadonlyMap<string, string>,
  limit: number,
) {
  const place = (id: string | null) => (id ? (places.get(id) ?? id) : "");
  const who = (personId: string) =>
    `${names.get(personId) ?? personId} (${personId})`;
  const moved = ready.filter((plan) => plan.movedFrom);
  const removed = ready.reduce((n, plan) => n + plan.remove.length, 0);
  const rejected = ready.reduce(
    (n, plan) =>
      n +
      plan.remove.reduce(
        (m, id) => m + (pendingOnRemoved.get(id)?.length ?? 0),
        0,
      ),
    0,
  );
  console.info(
    `\n${plans.length} runs stored twice${plans.length > ready.length + held.length ? `, the first ${limit} taken` : ""}:`,
  );
  console.info(
    `  ${ready.length - moved.length} keep the copy in place and remove the other`,
  );
  console.info(
    `  ${moved.length} keep the live copy, move it into place and remove the draft there`,
  );
  console.info(
    `  ${removed} copies to remove, ${rejected} revisions waiting on them to reject`,
  );
  for (const plan of ready) {
    const learnt = Object.entries(plan.learns)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
    console.info(
      `  ${who(plan.personId)} ${plan.startDate.slice(0, 4)} ${plan.office}: keep ${plan.keep}` +
        (plan.movedFrom
          ? ` [${plan.published ? "live" : "draft"}], moved ${place(plan.movedFrom)} -> ${place(plan.placeId)}`
          : ` [${plan.published ? "live" : "draft"}] in ${place(plan.placeId)}`) +
        `; remove ${plan.remove.join(", ")}` +
        (learnt ? `; learns ${learnt}` : ""),
    );
  }

  const byReason = new Map<string, SkippedRun[]>();
  for (const run of skipped) {
    byReason.set(run.reason, [...(byReason.get(run.reason) ?? []), run]);
  }
  if (skipped.length > 0 || held.length > 0) {
    console.info(`\nLeft for a person:`);
  }
  for (const [reason, runs] of byReason) {
    console.info(`  ${runs.length} ${reason}`);
    for (const run of runs) {
      console.info(
        `    ${who(run.personId)} ${run.startDate.slice(0, 4)} ${run.office}: ${run.ids.join(", ")}`,
      );
    }
  }
  for (const { plan, why } of held) {
    console.info(
      `  held: ${who(plan.personId)} ${plan.startDate.slice(0, 4)} ${plan.office}: ${why}`,
    );
  }
  return { removed };
}

/** Writes one fold into `batch`: the kept copy as it now reads, every other
 * copy removed with `reason`, every revision waiting on a removed copy
 * rejected with `rejectReason`. One batch per run, so none is left
 * half-folded. */
export function writeFold(
  db: Firestore,
  batch: WriteBatch,
  author: string,
  plan: RunPlan,
  stored: ReadonlyMap<string, Record<string, unknown>>,
  pendingOnRemoved: ReadonlyMap<string, string[]>,
  reason: string,
  rejectReason: string,
) {
  const user = { uid: author };
  if (plan.data) {
    createRevisionTransaction(
      db,
      batch,
      user,
      db.collection("edges").doc(plan.keep),
      plan.data,
      // Approved, as the correction it is; `stored` carries `published` and
      // the rest of what the document owns across.
      { automatic: true, approve: true, stored: stored.get(plan.keep)! },
    );
  }
  for (const id of plan.remove) {
    const removed = stored.get(id)!;
    // Withheld so this revision is the one that states them, as in
    // /api/edges/delete.
    const {
      deleted: _wasDeleted,
      delete_reason: _oldReason,
      ...carried
    } = removed;
    const { revisionRef } = createRevisionTransaction(
      db,
      batch,
      user,
      db.collection("edges").doc(id),
      {
        ...withoutInternalFields(removed),
        deleted: true,
        delete_reason: reason,
      },
      { stored: carried, approve: true, published: false },
    );
    recordAudit(
      db,
      {
        action: "delete",
        collection: "edges",
        target_id: id,
        revision_id: revisionRef.id,
        user: author,
        reason,
      },
      batch,
    );
    for (const revisionId of pendingOnRemoved.get(id) ?? []) {
      batch.update(db.collection("revisions").doc(revisionId), {
        status: "rejected",
        reject_reason: rejectReason,
        review_user: author,
        review_time: Timestamp.now(),
      });
      recordAudit(
        db,
        {
          action: "reject",
          collection: "edges",
          target_id: id,
          revision_id: revisionId,
          user: author,
          reason: rejectReason,
        },
        batch,
      );
    }
  }
}

/** The name of every person and every region a report mentions, by id. */
export async function namesOf(
  db: Firestore,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const docs = await db.getAll(
      ...unique.slice(i, i + 100).map((id) => db.collection("nodes").doc(id)),
    );
    for (const doc of docs) {
      names.set(doc.id, String(doc.data()?.name ?? doc.id));
    }
  }
  return names;
}

export function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
