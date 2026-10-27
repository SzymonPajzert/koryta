import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { candidacyElection } from "../../shared/electionDays";
import { approvedRevisionId, pageIsPublic } from "../../shared/model";
import { withoutInternalFields } from "../../server/utils/revisions";
import {
  blank,
  byId,
  disagree,
  fold,
  holdBack,
  namesOf,
  printPlans,
  revisionsOf,
  writeFold,
  type RunPlan,
  type StoredEdge,
} from "./fold-candidacies";
import { reportRemaining } from "./remaining";

/**
 * Take the „Uzyskano mandat” box a contributor left unticked off the
 * candidacies that still store it as `elected: false`, before a stored `false`
 * starts meaning a defeat.
 *
 * Until 2026-09-23 (b1a2c8b5) the edit forms saved an unticked box as `false`,
 * so the site could not read `false` as "lost" and the ingest wrote only wins.
 * Szymon, 2026-10-27: store PKW's losses as well, and show a result in three
 * states - won, lost, not known (store-election-losses-in-ingest-and-form).
 * Fifteen live candidacies still held a box's `false` on that morning's
 * export, and with losses stored they would read as defeats. PKW records some
 * of them as wins.
 *
 * Eight of the fifteen also sit beside the pipeline's own copy of the same
 * run. The forms used to save the date the row shows - the election day, or a
 * bare year - while the ingest matches a candidacy by the `YYYY-01-01` it
 * writes itself, so no later send found the old copy and each stored the run
 * again. Szymon, the same day: "remove the data on the side that contradicts
 * the pipeline data". So, per candidacy:
 *
 *   - where the pipeline has its own copy of the run - a live candidacy of the
 *     same person in the same election (`candidacyElection`), in the same place
 *     or one holding it, in the shape the ingest writes (a named office, a
 *     `YYYY-01-01` start), and only one - the old copy folds into it
 *     (fold-candidacies.ts). Where the two disagree - the office, the date, the
 *     party, the committee's spelling, the result - the pipeline's copy has it
 *     from PKW's files and its word stands; neither the box's `false` nor the
 *     day the form saved is read as anything at all. The pipeline's copy stays
 *     and the old one is removed, as /api/edges/delete removes one, the
 *     pipeline's copy learning what only the old one said, such as a source.
 *     Where the old copy is live and the pipeline's a draft, the old copy
 *     stays instead, so the run does not leave the page, and takes the
 *     pipeline's place and everything the pipeline's copy states.
 *   - otherwise the `false` comes off, with a revision, and the candidacy says
 *     nothing about the result until the pipeline or a reviewer does.
 *
 * WHAT IT LEAVES ALONE, and reports: a `false` stated on or after
 * `UNTICKED_BEFORE`, which is a recorded defeat - the pipeline's, or a
 * reviewer's - and not this script's; and a candidacy a person's proposal
 * waits on at /admin/rewizje, since their word stands. A run whose fold is
 * held back - two copies of the pipeline's that could be it, copies that each
 * say something the other does not (two different sources), a draft that
 * would learn, or `holdBack`'s reasons - has its `false` cleared and is listed
 * for a person.
 *
 * Like every script here it cannot clear the Nitro handler cache that
 * /api/edges/delete clears: a published page can show a removed copy for up to
 * six hours. Each write fires `onEdgeWritten`, and the sweep then recomputes
 * the person's `stats.edges` - their „Wygrali” / „Przegrali” keys among them.
 *
 * Usage, from frontend/, against the running emulator:
 *   npx tsx scripts/migrate/clear-unticked-elected.ts                  # dry run
 *   npx tsx scripts/migrate/clear-unticked-elected.ts --commit         # apply
 * Against production:
 *   npx tsx scripts/migrate/clear-unticked-elected.ts --prod           # dry run
 *   npx tsx scripts/migrate/clear-unticked-elected.ts --prod --commit
 */

const AUTHOR = "migration:clear-unticked-elected";

/** Before this nothing stored `elected: false` but an edit form's unticked
 * box: the ingest wrote only wins, and the forms stopped writing `false` on
 * 2026-09-23. From it on a `false` is a recorded defeat, which this script
 * never clears - so once the fifteen are done a re-run reads zero, whatever
 * losses the nights store after. */
export const UNTICKED_BEFORE = Date.parse("2026-10-27T00:00:00Z");

/** One revision of a candidacy, as far as this script reads it. */
export type RevisionFacts = {
  id: string;
  status?: unknown;
  update_time?: unknown;
  update_automatic?: unknown;
  data?: unknown;
};

/** A candidacy whose `false` comes off, and why it is not folded. */
export type Clear = { edge: StoredEdge; reason: string };

function millis(value: unknown): number {
  if (value && typeof (value as Timestamp).toMillis === "function") {
    return (value as Timestamp).toMillis();
  }
  if (typeof value === "string") return Date.parse(value);
  return typeof value === "number" ? value : Number.NaN;
}

/** A proposal a person filed, which the page does not show until a reviewer
 * approves it. */
function isProposal(revision: RevisionFacts): boolean {
  return revision.id.startsWith("proposal_");
}

/** Whether the `false` a candidacy stores now was stated before
 * `UNTICKED_BEFORE`: when the last revision that turned it to `false` from
 * anything else was written, walking them in order. Proposals do not count,
 * since nothing of theirs reaches the document until somebody approves them,
 * nor do rejected revisions. A candidacy no revision ever said `false` for got
 * it from a write that filed none, which is older still. */
export function untickedFalse(revisions: readonly RevisionFacts[]): boolean {
  const applied = revisions
    .filter((revision) => !isProposal(revision))
    .filter((revision) => revision.status !== "rejected")
    .sort((a, b) => millis(a.update_time) - millis(b.update_time));
  let turned: RevisionFacts | undefined;
  let before: unknown;
  for (const revision of applied) {
    const elected = (revision.data as { elected?: unknown } | undefined)
      ?.elected;
    if (elected === false && before !== false) turned = revision;
    before = elected;
  }
  return !turned || millis(turned.update_time) < UNTICKED_BEFORE;
}

/** The election a candidacy was in, as the stats read it. */
function electionOf(data: Record<string, unknown>) {
  return candidacyElection(
    typeof data.start_date === "string" ? data.start_date : null,
    typeof data.position === "string" ? data.position : null,
    data.by_election === true,
  );
}

/** Whether a candidacy is in the shape the ingest writes one: a named office,
 * and the `YYYY-01-01` start `createElection` gives every run. */
function pipelineShaped(data: Record<string, unknown>): boolean {
  return (
    typeof data.position === "string" &&
    data.position !== "" &&
    typeof data.start_date === "string" &&
    /^\d{4}-01-01$/.test(data.start_date)
  );
}

/** Whether two places are one, or one lies in the other: a powiat in its
 * województwo, a gmina in its powiat. A national run the old uploads filed
 * under the candidate's home is the same run as the one in its district. */
function nested(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && (a.startsWith(b) || b.startsWith(a));
}

/** The pipeline's copies of the run an unticked candidacy stands for: live
 * candidacies of the same person in the same election and place, in the shape
 * the ingest writes, that store no box's `false` of their own. */
export function twinsOf(
  old: StoredEdge,
  siblings: readonly StoredEdge[],
  terytOf: (regionId: unknown) => string | undefined,
): StoredEdge[] {
  const election = electionOf(old.data);
  if (!election) return [];
  return siblings
    .filter(
      (copy) =>
        copy.id !== old.id &&
        copy.data.deleted !== true &&
        copy.data.type === "election" &&
        copy.data.source === old.data.source &&
        copy.data.elected !== false &&
        pipelineShaped(copy.data) &&
        electionOf(copy.data) === election &&
        (copy.data.target === old.data.target ||
          nested(terytOf(copy.data.target), terytOf(old.data.target))),
    )
    .sort(byId);
}

/** What `createElection` states about a run, which the pipeline's copy has
 * from PKW's files. Where the old copy says otherwise, PKW's word stands. */
const PIPELINE_STATES = [
  "position",
  "start_date",
  "party",
  "committee",
  "elected",
] as const;

/** The old copy as the fold reads it: saying what the pipeline's copy states
 * wherever that one states it - the office, the run's year rather than the day
 * the form saved, the party, PKW's spelling of the committee, the result - and
 * without the box's `false`, or the end date the form used to save as the
 * election day too. What only the old copy says - a source, a party a joint
 * list leaves the pipeline's copy without - it still says. */
function asThePipelineSaysIt(old: StoredEdge, twin: StoredEdge): StoredEdge {
  const {
    elected: _box,
    end_date: endDate,
    ...data
  } = old.data as Record<string, unknown> & { end_date?: unknown };
  const year = String(twin.data.start_date).slice(0, 4);
  if (typeof endDate === "string" && !endDate.startsWith(year)) {
    data.end_date = endDate;
  }
  for (const key of PIPELINE_STATES) {
    if (!blank(twin.data[key])) data[key] = twin.data[key];
  }
  return { id: old.id, data };
}

/** The name `createElection` gives every candidacy, which says nothing about
 * it: an old copy calling the run „sejmik” does not disagree with it. */
function saysSomething(key: string, value: unknown): boolean {
  return !(key === "name" && value === "kandydatura");
}

/** What becomes of each unticked candidacy: folded into the pipeline's copy
 * of its run, or cleared, and why. */
export function planUnticked(
  unticked: readonly StoredEdge[],
  candidacies: readonly StoredEdge[],
  terytOf: (regionId: unknown) => string | undefined,
): { plans: RunPlan[]; clears: Clear[] } {
  const byPerson = new Map<string, StoredEdge[]>();
  for (const copy of candidacies) {
    const person = String(copy.data.source);
    byPerson.set(person, [...(byPerson.get(person) ?? []), copy]);
  }

  const plans: RunPlan[] = [];
  const clears: Clear[] = [];
  for (const old of [...unticked].sort(byId)) {
    const twins = twinsOf(
      old,
      byPerson.get(String(old.data.source)) ?? [],
      terytOf,
    );
    if (twins.length === 0) {
      clears.push({ edge: old, reason: "the pipeline has no copy of the run" });
      continue;
    }
    if (twins.length > 1) {
      clears.push({
        edge: old,
        reason: `${twins.length} copies of the pipeline's could be the run: ${twins.map((twin) => twin.id).join(", ")}`,
      });
      continue;
    }
    const twin = twins[0]!;
    const read = asThePipelineSaysIt(old, twin);
    if (disagree(read.data, twin.data, saysSomething)) {
      clears.push({
        edge: old,
        reason: `it and the pipeline's copy ${twin.id} each say something the other does not`,
      });
      continue;
    }
    const folded = fold(twin, [read]);
    if (folded === "draft would learn") {
      clears.push({
        edge: old,
        reason: `the pipeline's copy ${twin.id} is a draft that would learn from it`,
      });
      continue;
    }
    plans.push({
      personId: String(old.data.source),
      office: String(twin.data.position),
      startDate: String(twin.data.start_date),
      placeId: String(twin.data.target),
      ...folded,
      // The old copy kept is rewritten even where the fold finds it already
      // saying everything: the fold reads it without the box and the day, and
      // those are what the stored document still holds.
      data:
        folded.keep === old.id && folded.data === null
          ? withoutInternalFields(read.data)
          : folded.data,
    });
  }
  return { plans, clears };
}

/** What a removed old copy says on its way out. */
export function removalReason(plan: RunPlan): string {
  return (
    `Duplikat: ta sama kandydatura (${plan.office}, ${plan.startDate.slice(0, 4)}) ` +
    "była zapisana drugi raz przez formularz, z datą wyborów zamiast roku " +
    `i z nieodznaczonym „Uzyskano mandat”. Zostaje powiązanie ${plan.keep}.`
  );
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }
  const db = getFirestore(
    initializeApp({ projectId: "koryta-pl" }),
    "koryta-pl",
  );
  console.info(
    `${isProd ? "PRODUCTION" : `emulator ${process.env.FIRESTORE_EMULATOR_HOST}`}, ` +
      `${commit ? "writing" : "dry run"}`,
  );

  const regions = await db
    .collection("nodes")
    .where("type", "==", "region")
    .get();
  const teryts = new Map<string, string>();
  const regionNames = new Map<string, string>();
  for (const doc of regions.docs) {
    const data = doc.data();
    if (typeof data.teryt === "string") teryts.set(doc.id, data.teryt);
    regionNames.set(doc.id, String(data.name ?? doc.id));
  }
  const edges = await db
    .collection("edges")
    .where("type", "==", "election")
    .get();
  const candidacies = edges.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));
  const stored = new Map(edges.docs.map((doc) => [doc.id, doc.data()]));
  const snapshots = new Map(edges.docs.map((doc) => [doc.id, doc]));

  const storingFalse = candidacies.filter(
    (copy) => copy.data.deleted !== true && copy.data.elected === false,
  );
  const revisions = new Map<string, RevisionFacts[]>();
  for (const copy of storingFalse) {
    revisions.set(
      copy.id,
      (await revisionsOf(db, copy.id)).map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    );
  }
  const waitsOn = (id: string) =>
    (revisions.get(id) ?? []).find(
      (revision) => isProposal(revision) && revision.status === "pending",
    );
  const unticked = storingFalse.filter((copy) =>
    untickedFalse(revisions.get(copy.id) ?? []),
  );
  const leftAlone = unticked.filter((copy) => waitsOn(copy.id));
  console.info(
    `${edges.size} candidacies, ${storingFalse.length} of them live and storing elected: false: ` +
      `${unticked.length} stated before ${new Date(UNTICKED_BEFORE).toISOString().slice(0, 10)} ` +
      `(a box left unticked), ${storingFalse.length - unticked.length} since (a recorded defeat, not this script's)`,
  );

  const { plans, clears: unfolded } = planUnticked(
    unticked.filter((copy) => !waitsOn(copy.id)),
    candidacies,
    (regionId) => teryts.get(String(regionId)),
  );
  // A proposal waiting on a copy the fold would remove is somebody's word
  // about that run: the run is held, and only the box comes off.
  const { ready, held, pendingOnRemoved } = await holdBack(
    db,
    plans,
    stored,
    async (plan) => {
      for (const id of [plan.keep, ...plan.remove]) {
        const waiting = (await revisionsOf(db, id)).find(
          (doc) =>
            doc.id.startsWith("proposal_") && doc.data().status === "pending",
        );
        if (waiting)
          return `a proposal waits for review on ${id} (${waiting.id})`;
      }
      return undefined;
    },
  );
  const clears: Clear[] = [
    ...unfolded,
    ...held.flatMap(({ plan, why }) =>
      [plan.keep, ...plan.remove]
        .filter((id) => unticked.some((copy) => copy.id === id))
        .map((id) => ({ edge: { id, data: stored.get(id)! }, reason: why })),
    ),
  ];

  const names = await namesOf(db, [
    ...unticked.map((copy) => String(copy.data.source)),
  ]);
  const { removed } = printPlans(
    plans,
    ready,
    held,
    [],
    pendingOnRemoved,
    names,
    regionNames,
    Number.POSITIVE_INFINITY,
  );
  const who = (copy: StoredEdge) =>
    `${names.get(String(copy.data.source)) ?? copy.data.source} (${copy.data.source})`;
  console.info(
    `\nResults to clear, the run staying as it is (${clears.length}):`,
  );
  for (const { edge, reason } of clears) {
    console.info(
      `  ${who(edge)} ${String(edge.data.start_date ?? "no date")} in ` +
        `${regionNames.get(String(edge.data.target)) ?? edge.data.target}: ${edge.id} - ${reason}`,
    );
  }
  if (leftAlone.length > 0) {
    console.info(
      `\nLeft alone, a person's proposal waits (${leftAlone.length}):`,
    );
    for (const copy of leftAlone) {
      console.info(`  ${who(copy)}: ${copy.id} (${waitsOn(copy.id)!.id})`);
    }
  }

  if (!commit) {
    reportRemaining({ folds: ready.length, removed, clears: clears.length });
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  for (const plan of ready) {
    const batch = db.batch();
    writeFold(
      db,
      batch,
      AUTHOR,
      plan,
      stored,
      pendingOnRemoved,
      removalReason(plan),
      `Zastąpiona: ta sama kandydatura jest w powiązaniu ${plan.keep}.`,
    );
    await batch.commit();
  }

  // As archive/clear-crawl-stamp-job-ends.ts clears a stamp: a revision with
  // the whole document but the field, approved where the edge is shown by an
  // approved revision or is live, and a targeted update rather than the
  // snapshot written back, conditional on the edge being as it was read.
  const approves = (data: Record<string, unknown>) =>
    approvedRevisionId(data.revision_id) !== undefined || pageIsPublic(data);
  let batch = db.batch();
  let pending = 0;
  for (const { edge } of clears) {
    const data = stored.get(edge.id)!;
    const revisionData = withoutInternalFields(data);
    delete revisionData.elected;
    const approve = approves(data);
    const revisionRef = db.collection("revisions").doc();
    const now = Timestamp.now();
    batch.set(revisionRef, {
      node_id: edge.id,
      collection: "edges",
      data: revisionData,
      update_time: now,
      update_user: AUTHOR,
      update_automatic: true,
      status: approve ? "approved" : "pending",
      ...(approve ? { review_user: AUTHOR, review_time: now } : {}),
    });
    const update: Record<string, unknown> = { elected: FieldValue.delete() };
    if (approve) update.revision_id = revisionRef;
    batch.update(snapshots.get(edge.id)!.ref, update, {
      lastUpdateTime: snapshots.get(edge.id)!.updateTime,
    });
    pending += 2;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.info(
    `\nFolded ${ready.length} runs (${removed} copies removed) and cleared ` +
      `${clears.length} results, each with a revision by ${AUTHOR}.`,
  );
  console.info("Re-run the dry run: it must report nothing left to change.");
}

// Importable by the tests, which check the decisions without Firestore.
if (process.argv[1]?.endsWith("clear-unticked-elected.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
