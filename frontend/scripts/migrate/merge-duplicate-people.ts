import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type {
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import {
  applyNodeMerge,
  edgesTouching,
  mergeRefusal,
  planNodeMerge,
  type MergeDisposition,
  type MergePlan,
} from "../../server/utils/merge";
import { pageIsPublic } from "../../shared/model";

/**
 * One-time migration: fold together the person pages that are one human filed
 * twice, and only those.
 *
 * The pipeline's name for a person is whatever the source it read that run
 * happened to print, and the person ingest used to match an existing page by
 * that string alone. So "Andrzej Golimont" and "Andrzej Marcin Golimont" - both
 * `rejestr.io/osoby/383093`, one man - became two pages, each holding half of
 * what is known about him. Against the production export of 2026-08-29T23:20Z
 * that is 170 pairs: 156 differ only by a middle name, 14 by case or
 * punctuation.
 *
 * The cause is fixed in `server/api/ingest/person.post.ts` - `lookupPersonDoc`
 * now matches on `rejestrIo` first and accepts a name match only where the
 * stored page carries no register id of its own, so a third spelling of the
 * same man lands on the page that already exists. This repairs what the old
 * rule wrote before that.
 *
 * `rejestrIo` is the identity, compared exactly, because exact equality is what
 * the ingest itself compares. Grouping on anything looser - a normalised url, a
 * trimmed id - would fold together two pages that the ingest will go on
 * treating as different people, and the next run would recreate the duplicate
 * this removed. A person with no register id is not considered at all: nothing
 * stored tells two namesakes apart, and guessing from the name is exactly the
 * mistake being repaired.
 *
 * What each merge does lives in `server/utils/merge.ts` and is not repeated
 * here. `planNodeMerge` works out where every relation of the duplicate ends
 * up, `applyNodeMerge` writes it, and the same pair backs `/api/nodes/merge` -
 * so what an admin does by hand from the page and what this does to 170 pairs
 * at once cannot drift apart. In particular this script never decides on its
 * own that two relations are one fact: `employed` collapses because
 * `identicalMeansSame` says a fully dated spell stated twice is one spell, and
 * `election` never does, because the office and the run-off round are destroyed
 * upstream and two byte-identical candidacies may be two real bids. Against the
 * same export that is 2035 outbound and 9 inbound relations moved, of which 524
 * land on something the survivor already says: 452 `employed` collapsed and 72
 * `election` moved across and reported for a human.
 *
 * This does NOT touch the other half of the problem. 36 person pages have had
 * their `rejestrIo` overwritten by a second human's - two people on one page,
 * the opposite error - and no merge can help there; that is `needs_split` and
 * `/api/nodes/split`.
 *
 * Cost, and why not at a busy moment: every relation this writes fires
 * `onEdgeWritten` (`functions/src/edges.ts`), which re-reads every edge of the
 * relation's source node to recompute its stats. A full run is ~2000 trigger
 * invocations, each of them a small collection query, and they land over the
 * minutes the script takes. Run it when nothing else is loading the database,
 * and start with `--limit 10`.
 *
 * Note also that `/api/nodes/merge` clears the Nitro handler cache after a
 * merge and a script cannot: the entity and graph endpoints are cached for six
 * hours, so a merged page can keep serving its old relations until then. That
 * is a delay, not a wrong answer - `getEntity` resolves `merged_into` on the
 * way in once the cache turns over.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/merge-duplicate-people.ts                # dry run
 *   npx tsx scripts/migrate/merge-duplicate-people.ts --limit 10 --commit
 * Against production:
 *   npx tsx scripts/migrate/merge-duplicate-people.ts --prod         # dry run
 *   npx tsx scripts/migrate/merge-duplicate-people.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
/** At most this many duplicate groups, so the first run can do ten and be
 * looked at before the rest follows. Groups are taken in a stable order, so
 * `--limit 10` twice is the same ten. */
const limit = Number(argValue("--limit") ?? Number.POSITIVE_INFINITY);

if (Number.isNaN(limit) || limit < 1) {
  console.error("--limit takes a positive number of duplicate groups.");
  process.exit(1);
}

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

const AUTHOR = "migration:merge-duplicate-people";

/** Filed on every merge, and on the revision of every relation it removes, so
 * that a page found `deleted` a year from now says why in the place somebody
 * would look. */
const REASON =
  "Scalenie duplikatów: ta sama osoba (ten sam identyfikator rejestr.io) " +
  "miała dwie strony, bo import dopasowywał osoby po nazwie.";

/** Firestore's limit is 500 writes in one batch. A merge is committed whole
 * (see `mergeWrites`), so this is a ceiling on a single merge rather than a
 * chunk size. */
const BATCH_LIMIT = 500;

/** What a dry run against production measured on 2026-08-30.
 *
 * Printed against the run's own totals rather than asserted: the database moves
 * on, and a migration that refuses to run because a number grew by three is
 * useless. What this catches is the other kind of disagreement - a predicate
 * that matches everything, or nothing - which looks like an order of magnitude
 * and not like drift.
 *
 * `edges` counts the relations this MOVES, which is the duplicates' relations
 * and not the survivors'. Reading the export instead gives 2044, because that
 * is every relation touching either page of every pair, and the survivor's stay
 * where they are. The two numbers answer different questions and only this one
 * is about work.
 */
const EXPECTED = { groups: 170, edges: 900, collapsed: 445, review: 49 };

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

/** How much this page knows, for choosing which copy of a person to keep.
 *
 * The same count `dedupe-edges.ts` makes about an edge, and it skips the same
 * fields: the ones that say how the document is being reviewed and shown rather
 * than anything about the person. `stats` and `revisions` go too - they are
 * derived from the relations and the revision log, so counting them would let
 * the trigger that last ran decide which page survives.
 */
const NOT_ABOUT_THE_PERSON = new Set([
  "revision_id",
  "published",
  "visibility",
  "deleted",
  "delete_reason",
  "merged_into",
  "stats",
  "revisions",
  "votes",
  "id",
  "nameChunksLower",
]);

function informativeness(doc: QueryDocumentSnapshot): number {
  return Object.entries(doc.data()).filter(
    ([key, value]) =>
      !NOT_ABOUT_THE_PERSON.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== "",
  ).length;
}

type Candidate = {
  doc: QueryDocumentSnapshot;
  /** Relations at either end, counted before anything is written so that the
   * choice does not depend on which group was merged first. */
  relations: number;
};

/** How much of a name the page carries, for choosing between two spellings.
 *
 * Characters rather than words, so it prefers a fuller surname as well as a
 * middle name - "Malgorzata Pietrzak Sikorska" over "Malgorzata Sikorska" as
 * much as "Andrzej Marcin Golimont" over "Andrzej Golimont". Only ever reached
 * when the two pages know the same number of fields, so it is breaking a tie
 * rather than outweighing anything.
 */
function nameLength(doc: QueryDocumentSnapshot): number {
  const name = doc.data().name;
  return typeof name === "string" ? name.trim().length : 0;
}

/** The page to keep, in the order `dedupe-edges.ts` keeps a copy of an edge,
 * read across to a page:
 *
 *   1. published (`pageIsPublic`) — keeping the hidden copy would take a person
 *      off the site for a logged out visitor, which is a change nobody asked
 *      for. This is `pageIsPublic` and not `revision_id`, because a page can
 *      have an approved revision and still be a draft.
 *   2. an approved revision (`revision_id`) — the survivor inherits the
 *      relations either way, but a page with a revision behind it has a history
 *      to hang the merge off and an admin can un-approve back past it.
 *   3. more non-empty fields — ahead of the relation count, because relations
 *      are moved and fields are not. Whatever the loser knows and the winner
 *      does not is off the live page after the merge; a relation on the wrong
 *      page is only a write away from the right one. Losing least is the more
 *      important of the two, so it is asked first.
 *   4. the longer name, where the two know the same number of fields — the
 *      count above measures whether `name` is set, and both pages always have
 *      one, so on its own it cannot tell "Andrzej Marcin Golimont" from
 *      "Andrzej Golimont". Length can, and the fuller one carries the middle
 *      name the register recorded. It settles what would otherwise be a coin
 *      toss for a third of the batch.
 *   5. more relations — the same end state for fewer writes and fewer
 *      `onEdgeWritten` invocations, and the page whose url is likelier to have
 *      been linked to.
 *   6. the lexically smaller id — arbitrary, and stable, which is the point: a
 *      dry run has to name the same survivor the real run will, or reading the
 *      dry run proves nothing.
 *
 * Note that this decides which page *survives*, not what it ends up called.
 * The two agree anyway: `canonical_name` in the pipeline names a page with the
 * fullest spelling the register has, and an upload renames an existing page
 * only to write such a middle name in (`updatedPerson`) - so preferring the
 * longer name here keeps the spelling the pipeline would have chosen.
 */
function pickSurvivor(group: Candidate[]): Candidate {
  const published = group.filter((c) => pageIsPublic(c.doc.data()));
  const pool = published.length > 0 ? published : group;

  const approved = pool.filter((c) => !!c.doc.data().revision_id);
  const candidates = approved.length > 0 ? approved : pool;

  return candidates.reduce((best, c) => {
    const known = informativeness(c.doc) - informativeness(best.doc);
    if (known !== 0) return known > 0 ? c : best;

    const named = nameLength(c.doc) - nameLength(best.doc);
    if (named !== 0) return named > 0 ? c : best;

    if (c.relations !== best.relations) {
      return c.relations > best.relations ? c : best;
    }
    return c.doc.id < best.doc.id ? c : best;
  });
}

/** How many document writes carrying out this plan costs.
 *
 * A moved relation is one update. A collapsed or self-pointing one is two: the
 * revision that records why it went, and the edge it is written onto - the pair
 * `createRevisionTransaction` files. The node's own tombstone and the audit
 * entry are one each.
 */
function mergeWrites(plan: MergePlan): number {
  const { moved, review, collapsed, enriched, self } = plan.counts;
  const carrying = Object.keys(plan.carried).length > 0 ? 2 : 0;
  // A re-filed vote is a write and a delete.
  const voting = 2 * plan.votes.length;
  // An enriched relation costs four: the revision and edge that fill in the
  // survivor's copy, and the revision and edge that retire this one.
  return (
    moved +
    review +
    2 * (collapsed + self) +
    4 * enriched +
    2 +
    carrying +
    voting
  );
}

function emptyCounts(): Record<MergeDisposition, number> {
  return { moved: 0, collapsed: 0, enriched: 0, review: 0, self: 0 };
}

/** Runs `task` over `items` a few at a time.
 *
 * The survivor choice needs the relation count of every candidate page, which
 * is two queries each and ~340 pages. Sequentially that is a few minutes of
 * round trips for a dry run that writes nothing; ten at a time is well inside
 * what the emulator and the production database will take from one client.
 */
async function mapLimited<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  concurrency = 10,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += concurrency) {
    const chunk = items.slice(start, start + concurrency);
    results.push(...(await Promise.all(chunk.map(task))));
  }
  return results;
}

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const peopleSnap = await db
    .collection("nodes")
    .where("type", "==", "person")
    .get();
  console.log(`Read ${peopleSnap.size} person page(s).`);

  // Grouped on the stored `rejestrIo` exactly, and only over pages that are
  // still standing. A page already merged away is what a previous run of this
  // left behind, so skipping it is what makes a second run report nothing; a
  // page an admin deleted for some other reason is a decision this migration
  // has no business reversing by moving its relations onto somebody live.
  const groups = new Map<string, QueryDocumentSnapshot[]>();
  let alreadyMerged = 0;
  let deleted = 0;
  let withoutRegisterId = 0;

  for (const doc of peopleSnap.docs) {
    const data = doc.data();
    if (typeof data.merged_into === "string" && data.merged_into) {
      alreadyMerged++;
      continue;
    }
    if (data.deleted === true) {
      deleted++;
      continue;
    }
    const register = data.rejestrIo;
    if (typeof register !== "string" || register === "") {
      withoutRegisterId++;
      continue;
    }
    groups.set(register, [...(groups.get(register) ?? []), doc]);
  }

  const duplicated = [...groups.entries()]
    .filter(([, docs]) => docs.length > 1)
    // Keyed order is insertion order, which is the query's order and stable
    // enough - but sorting makes `--limit 10` name the same ten whatever the
    // query returns first.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  console.log(
    `  ${withoutRegisterId} page(s) carry no rejestr.io id and are left alone.\n` +
      `  ${alreadyMerged} page(s) are already merged away, ${deleted} deleted.\n` +
      `  ${duplicated.length} register id(s) are on more than one page.`,
  );

  if (duplicated.length === 0) {
    console.log("\nNothing to merge.");
    return;
  }

  const selected = duplicated.slice(0, limit);
  if (selected.length < duplicated.length) {
    console.log(
      `  --limit ${limit}: doing ${selected.length} of them this run.`,
    );
  }

  // Every plan is worked out before anything is written, so the dry run prints
  // the numbers the committing run will act on and the survivor choice cannot
  // be swayed by a merge that happened earlier in the same run.
  const merges: MergePlan[] = [];
  const totals = emptyCounts();
  const byType: Record<string, Record<MergeDisposition, number>> = {};
  const oversized: MergePlan[] = [];
  const refused: { duplicate_id: string; refusal: string }[] = [];
  /** The first few groups, printed in full, so a human can check that the two
   * pages really are one person before agreeing to 170 of these. */
  let printed = 0;

  for (const [register, docs] of selected) {
    const candidates = await mapLimited(docs, async (doc) => ({
      doc,
      relations: (await edgesTouching(db, doc.id)).length,
    }));
    const survivor = pickSurvivor(candidates);

    for (const { doc } of candidates) {
      if (doc.id === survivor.doc.id) continue;

      // The same refusals `/api/nodes/merge` makes, asked before the plan is
      // worked out. None of them can fire from here - the group is one type,
      // the survivor is not the duplicate, and a merged page never reached this
      // far - which is why it is worth asking: if one ever does, the assumption
      // that got it here is wrong and the merge should not happen.
      const refusal = mergeRefusal(
        { duplicate_id: doc.id, survivor_id: survivor.doc.id },
        doc,
        survivor.doc,
      );
      if (refusal) {
        refused.push({ duplicate_id: doc.id, refusal });
        continue;
      }

      const plan = await planNodeMerge(db, doc.id, survivor.doc.id);
      if (mergeWrites(plan) > BATCH_LIMIT) {
        oversized.push(plan);
        continue;
      }

      for (const edge of plan.edges) {
        totals[edge.disposition]++;
        const perType = (byType[edge.type] ??= emptyCounts());
        perType[edge.disposition]++;
      }
      merges.push(plan);
    }

    if (printed < 10) {
      printed++;
      const names = candidates
        .map(
          ({ doc, relations }) =>
            `${doc.id === survivor.doc.id ? "keep " : "merge"} ` +
            `${doc.data().name} (${doc.id}, ${relations} rel.)`,
        )
        .join("\n      ");
      console.log(`\n  rejestr.io ${register}\n      ${names}`);
    }
  }

  const edgeTotal = Object.values(totals).reduce((sum, n) => sum + n, 0);
  console.log(
    `\n  ${merges.length} page(s) to merge across ${selected.length} group(s).\n` +
      `  ${edgeTotal} relation(s): ${totals.moved} moved, ` +
      `${totals.collapsed} collapsed, ${totals.enriched} folded into a ` +
      `fuller copy the survivor already had, ${totals.review} moved but identical ` +
      `to one the survivor already holds, ${totals.self} self-pointing.`,
  );
  for (const [type, counts] of Object.entries(byType).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    console.log(
      `    ${type}: ${counts.moved} moved, ${counts.collapsed} collapsed, ` +
        `${counts.enriched} enriched, ` +
        `${counts.review} to review, ${counts.self} self`,
    );
  }
  const voteTotal = merges.reduce((n, plan) => n + plan.votes.length, 0);
  if (voteTotal > 0) {
    console.log(
      `  ${voteTotal} human vote(s) re-filed onto the surviving page. A vote ` +
        `by somebody who had already voted there stays on the duplicate, ` +
        `and a scoring model's is left for the next run to recreate.`,
    );
  }
  const carrying = merges.filter(
    (plan) => Object.keys(plan.carried).length > 0,
  );
  if (carrying.length > 0) {
    const byField = new Map<string, number>();
    for (const plan of carrying) {
      for (const field of Object.keys(plan.carried)) {
        byField.set(field, (byField.get(field) ?? 0) + 1);
      }
    }
    console.log(
      `  ${carrying.length} merge(s) carry a field the surviving page did ` +
        `not have: ` +
        [...byField.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([field, count]) => `${field} x${count}`)
          .join(", "),
    );
  }
  if (totals.review > 0) {
    console.log(
      `  The ${totals.review} to review are kept, not collapsed: for their ` +
        `type identical fields are not evidence of one fact (see ` +
        `identicalMeansSame in server/utils/edges.ts). Somebody has to read ` +
        `them on the surviving page afterwards.`,
    );
  }
  for (const { duplicate_id, refusal } of refused) {
    console.log(`  refused ${duplicate_id}: ${refusal}`);
  }
  for (const plan of oversized) {
    console.log(
      `  skipped ${plan.duplicate_id} -> ${plan.survivor_id}: ` +
        `${mergeWrites(plan)} writes exceeds the ${BATCH_LIMIT} a batch takes, ` +
        `and splitting it would leave the merge half-applied. Merge it by ` +
        `hand from /api/nodes/merge.`,
    );
  }

  reportAgainstExpectations(selected.length, edgeTotal, totals);

  if (!commit) {
    console.log("\nDry run — nothing written.");
    return;
  }

  // One batch per merge, committed before the next is planned. A batch is
  // atomic, so no merge can be left half-applied: a failure stops the script
  // with every merge before it whole and every merge after it untouched, and
  // re-running finishes the job because a merged page is skipped on the way in.
  // The alternative - packing several merges into a 400-write batch - would
  // save round trips and buy nothing, since 400 writes is only ~30 merges.
  let done = 0;
  let redone = 0;
  for (const plan of merges) {
    // Re-planned against what is stored now rather than trusting the plan
    // printed above. Within a group of three the first merge moves relations
    // onto the survivor, and the second may then be moving one the survivor has
    // just acquired - which the up-front plan, made against the untouched
    // database, calls a move and this calls a collapse. For a pair, which is
    // 170 of the 170 groups measured, the two are identical.
    const fresh = await planNodeMerge(db, plan.duplicate_id, plan.survivor_id);
    if (!sameDispositions(plan, fresh)) redone++;
    if (mergeWrites(fresh) > BATCH_LIMIT) {
      console.log(
        `  skipped ${fresh.duplicate_id}: grew past ${BATCH_LIMIT} writes ` +
          `since it was planned.`,
      );
      continue;
    }

    const storedEdges = await readStoredEdges(db, fresh);
    // Re-read with the plan rather than from the loop above: `fresh` was made
    // against the database as it is now, and an earlier merge in this same
    // group may have just carried fields onto this survivor.
    const survivorDoc = await db
      .collection("nodes")
      .doc(fresh.survivor_id)
      .get();
    const storedVotes = new Map<string, Record<string, unknown>>();
    if (fresh.votes.length > 0) {
      const voteDocs = await db.getAll(
        ...fresh.votes.map((vote) => db.collection("votes").doc(vote.from_id)),
      );
      for (const doc of voteDocs) {
        if (doc.exists) storedVotes.set(doc.id, doc.data() ?? {});
      }
    }

    const batch = db.batch();
    applyNodeMerge(
      db,
      batch,
      { uid: AUTHOR },
      fresh,
      REASON,
      storedEdges,
      survivorDoc.data(),
      storedVotes,
    );
    await batch.commit();

    done++;
    if (done % 25 === 0) {
      console.log(`  merged ${done}/${merges.length}`);
    }
  }

  console.log(
    `\nMerged ${done} page(s).` +
      (redone > 0
        ? ` ${redone} of them differed from the printed plan and were applied ` +
          `as re-planned; that is a group of three or more, where an earlier ` +
          `merge in the same group had already moved the relation.`
        : ""),
  );
}

/** The relations the plan covers, as `applyNodeMerge` wants them: read once
 * here rather than a second time inside it, exactly as `/api/nodes/merge`
 * does. */
async function readStoredEdges(
  db: Firestore,
  plan: MergePlan,
): Promise<Map<string, Record<string, unknown>>> {
  const stored = new Map<string, Record<string, unknown>>();
  if (plan.edges.length === 0) return stored;

  // Both ends of every verdict: the relation being moved, and - for an
  // `enriched` one - the survivor's relation that is about to learn from it,
  // which `applyNodeMerge` has to read before it can write the fuller version.
  const edgeIds = [
    ...new Set(
      plan.edges.flatMap((edge) =>
        edge.disposition === "enriched" && edge.duplicate_of
          ? [edge.edge_id, edge.duplicate_of]
          : [edge.edge_id],
      ),
    ),
  ];
  const docs = await db.getAll(
    ...edgeIds.map((id) => db.collection("edges").doc(id)),
  );
  for (const doc of docs) {
    if (doc.exists) stored.set(doc.id, doc.data() ?? {});
  }
  return stored;
}

/** Whether two plans for one merge reached the same verdict everywhere. */
function sameDispositions(a: MergePlan, b: MergePlan): boolean {
  if (a.edges.length !== b.edges.length) return false;
  const before = new Map(a.edges.map((e) => [e.edge_id, e.disposition]));
  return b.edges.every((e) => before.get(e.edge_id) === e.disposition);
}

/** Says so, loudly, when the run bears no resemblance to what was measured.
 *
 * A `--limit` run is not comparable and is not compared. Neither is a second
 * run, which should find nothing - that is the idempotence check the README
 * asks for, and it reports zero by design.
 */
function reportAgainstExpectations(
  groups: number,
  edgeTotal: number,
  totals: Record<MergeDisposition, number>,
) {
  if (Number.isFinite(limit)) return;
  if (groups === 0) return;

  const off = (actual: number, expected: number) =>
    actual < expected / 2 || actual > expected * 2;

  const wrong: string[] = [];
  if (off(groups, EXPECTED.groups)) {
    wrong.push(`${groups} groups, expected about ${EXPECTED.groups}`);
  }
  if (off(edgeTotal, EXPECTED.edges)) {
    wrong.push(`${edgeTotal} relations, expected about ${EXPECTED.edges}`);
  }
  if (off(totals.collapsed, EXPECTED.collapsed)) {
    wrong.push(
      `${totals.collapsed} collapsed, expected about ${EXPECTED.collapsed}`,
    );
  }
  if (off(totals.review, EXPECTED.review)) {
    wrong.push(`${totals.review} to review, expected about ${EXPECTED.review}`);
  }
  if (wrong.length === 0) return;

  console.log(
    `\n  !! This run does not look like the 2026-08-29 production export:\n` +
      wrong.map((line) => `     ${line}`).join("\n") +
      `\n     Either the data has moved a long way since, or the grouping is ` +
      `matching\n     something it should not. Read the groups printed above ` +
      `before committing.`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
