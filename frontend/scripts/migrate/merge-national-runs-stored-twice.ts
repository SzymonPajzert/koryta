import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  edgeRelation,
  isDistrictOffice,
  isSameRun,
  misfiledRunOf,
  type EdgeLike,
} from "../../server/utils/edges";
import {
  createRevisionTransaction,
  sameStoredValue,
  withoutInternalFields,
} from "../../server/utils/revisions";
import { recordAudit } from "../../server/utils/audit";
import { reportRemaining } from "./remaining";

/**
 * Fold together the Sejm, Senate and European Parliament runs stored twice:
 * once under the candidate's home and once under the district's województwo.
 *
 * Every upload before 2026-07-30 could file such a run under the place PKW's
 * list gives as the candidate's home. The merge kept that code and the
 * district's in one list that did not keep its order, and everything took the
 * first of them; df49f43e ("File a candidacy where it was run, not where the
 * candidate lives") fixed that. Since then the payload places the run under
 * its district, and the ingest, which looks for a stored candidacy under the
 * payload's region only, could not see the copy at home - so the next send
 * stored the run a second time beside it. Michał Jerzy Sobczak's 2023 Sejm run
 * is how it was noticed: live under Łódź since his page was published, and a
 * draft under łódzkie, with the committee, from the 2026-09-12 upload. On the
 * 2026-10-23 export 168 runs were stored twice that way (154 filed under their
 * office, 14 bare 2023 ones), on pages published and not.
 *
 * The cause is fixed in `server/api/ingest/person.post.ts`:
 * `moveMisfiledCandidacy` moves a Sejm or Senate copy at home to the district
 * when it sends the run, as it already did a European one, instead of storing
 * the run again. This folds the runs stored twice before it did. Which stored
 * copy is the run at home is one question, answered for both by
 * `misfiledRunOf` in `server/utils/edges.ts`: the same office in the same year
 * (or no office in a year that held nothing else), filed below a województwo,
 * for the Sejm and the Senate inside the district's, and nothing about the two
 * disagreeing.
 *
 * ONE EDGE PER RUN, the live one where there is a choice:
 *
 *   - the district's copy is live, or neither is: the district's copy stays
 *     where it is, and the copy at home is removed;
 *   - only the copy at home is live (39 runs, Sobczak's among them): that copy
 *     stays, keeping its id, its history and its place on the page, and moves
 *     to the district, learning what the district's copy said that it did not -
 *     the committee, the party, the result, the office. The district's copy is
 *     removed.
 *
 * Moving the live copy rather than publishing the draft is what keeps the
 * reviewer's approval of it, and the kept copy has to learn everything the
 * removed one said: the ingest prefers a copy asserting exactly what a payload
 * row does (`preferredCopy`), and a removed copy saying more than the live one
 * would take every later send of the run, leaving the live one as it is. The
 * committee is written out without a reviewer, as the ingest itself writes
 * one it recognises: 37 of the 39 are committees the curated table names,
 * and the other two are Mniejszość Niemiecka's, a KWW of long standing - the
 * dry run prints every committee it writes onto a live run, for reading
 * before `--commit`.
 *
 * A copy is removed the way `/api/edges/delete` and a page merge remove one:
 * `deleted: true` and a `delete_reason`, with an approved removal revision and
 * an audit entry, so the reason it went is on the record. A revision still
 * waiting for review on a removed copy is rejected with it - the review queue
 * lists the revisions of a removed relation like any other's - and its reason
 * names the copy that stays.
 *
 * WHAT IT LEAVES ALONE, and reports:
 *   - a copy at home in another województwo than the district's: a page
 *     standing in two places in one election, which could as well be a
 *     namesake's run, and is a reviewer's (`shared/twoPlaces.ts`);
 *   - a run whose copies disagree about anything, or which has more than one
 *     copy under a województwo, or whose copy at home fits two runs;
 *   - a run whose kept copy is a draft that would learn something from the
 *     copy removed: a draft's content is a reviewer's to approve;
 *   - a run where the live copy at home holds a revision still waiting for
 *     review, a removed copy carries votes, or a fact was promoted into one.
 *     None of those were found on the 10-23 export; each is checked rather
 *     than assumed.
 *
 * Cost: each edge it writes fires `onEdgeWritten` (`functions/src/edges.ts`),
 * which marks the person for the stats sweep - a few hundred of those for the
 * whole run. The entity and graph endpoints are cached for six hours and a
 * script cannot clear that cache, so a page can show both copies until it
 * turns over.
 *
 * Usage, from frontend/ (the server tsconfig resolves nothing this needs, but
 * it is what `check:archived-migrations` runs every script under):
 *   npx tsx --tsconfig .nuxt/tsconfig.server.json \
 *     scripts/migrate/merge-national-runs-stored-twice.ts                  # dry run, emulator
 *   ... merge-national-runs-stored-twice.ts --commit                       # apply, emulator
 *   ... merge-national-runs-stored-twice.ts --prod                         # dry run, PRODUCTION
 *   ... merge-national-runs-stored-twice.ts --prod --commit --limit 10     # the first ten
 *   ... merge-national-runs-stored-twice.ts --prod --commit
 */

const AUTHOR = "migration:merge-national-runs-stored-twice";

/** One stored edge, as read. */
export type StoredEdge = { id: string; data: Record<string, unknown> };

/** What becomes of one run stored twice. */
export type RunPlan = {
  personId: string;
  office: string;
  startDate: string;
  /** The region of the district's copy: the województwo the run belongs in. */
  districtId: string;
  /** The copy that stays. */
  keep: string;
  /** Where the kept copy was filed before, when it is the copy at home moving
   * to the district; null when it is the district's copy, staying put. */
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

/** Why a run stored twice is left for a person rather than folded. */
export type SkipReason =
  | "home in another województwo"
  | "copies disagree"
  | "several district copies"
  | "copy fits two runs"
  | "draft would learn";

export type SkippedRun = {
  reason: SkipReason;
  personId: string;
  office: string;
  startDate: string;
  ids: string[];
};

function byId(a: StoredEdge, b: StoredEdge): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A field with nothing in it, as the edit form and the ingest write nothing:
 * `field` in server/utils/edges.ts, and an empty list as well. */
function blank(value: unknown): boolean {
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
 * a reviewer added to one copy is not dropped for the other's. */
function disagree(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (
    edgeRelation(a as EdgeLike, b as EdgeLike) === "conflict" ||
    edgeRelation(b as EdgeLike, a as EdgeLike) === "conflict"
  ) {
    return true;
  }
  const left = withoutInternalFields(a);
  const right = withoutInternalFields(b);
  return Object.keys(left).some(
    (key) =>
      !PLACE_FIELDS.has(key) &&
      !blank(left[key]) &&
      !blank(right[key]) &&
      // The pipeline's committee in whatever case that year's file had is
      // the same committee; `edgeRelation` already compared it folded.
      key !== "committee" &&
      !sameStoredValue(left[key], right[key]),
  );
}

/** What to do with every run stored twice among `edges`: the person's
 * candidacies, read whole. Pure, so the dry run, the run and the tests reason
 * the same way. `terytOf` answers a region node's TERYT code by its id. */
export function planRuns(
  edges: readonly StoredEdge[],
  terytOf: (regionId: unknown) => string | undefined,
): { plans: RunPlan[]; skipped: SkippedRun[] } {
  const byPerson = new Map<string, StoredEdge[]>();
  for (const edge of edges) {
    if (edge.data.type !== "election" || edge.data.deleted === true) continue;
    const source = edge.data.source;
    if (typeof source !== "string" || !source) continue;
    byPerson.set(source, [...(byPerson.get(source) ?? []), edge]);
  }

  const plans: RunPlan[] = [];
  const skipped: SkippedRun[] = [];
  for (const personId of [...byPerson.keys()].sort()) {
    const candidacies = [...byPerson.get(personId)!].sort(byId);

    // The copies filed under a województwo, by the run they are of.
    const districtCopies = new Map<string, StoredEdge[]>();
    for (const edge of candidacies) {
      const office = edge.data.position;
      if (!isDistrictOffice(office) || !edge.data.start_date) continue;
      if (terytOf(edge.data.target)?.length !== 2) continue;
      const key = JSON.stringify([office, edge.data.start_date]);
      districtCopies.set(key, [...(districtCopies.get(key) ?? []), edge]);
    }

    const found: {
      district: StoredEdge;
      office: string;
      startDate: string;
      homes: StoredEdge[];
    }[] = [];
    for (const copies of districtCopies.values()) {
      const district = copies[0]!;
      const office = String(district.data.position);
      const startDate = String(district.data.start_date);
      const districtTeryt = terytOf(district.data.target);
      const homesOf = (of: StoredEdge) =>
        candidacies.filter(
          (edge) =>
            !copies.includes(edge) &&
            misfiledRunOf(
              edge.data as EdgeLike,
              terytOf(edge.data.target),
              of.data as EdgeLike,
              terytOf(of.data.target),
            ),
        );
      const homes = homesOf(district);

      // The copies below a województwo that are this run by office and year
      // but not ones `misfiledRunOf` takes: at a home outside the district's
      // województwo, or saying something the district's copy contradicts.
      // Reported, never folded.
      const elsewhere: StoredEdge[] = [];
      const contradicting: StoredEdge[] = [];
      for (const edge of candidacies) {
        const teryt = terytOf(edge.data.target);
        if (
          copies.includes(edge) ||
          homes.includes(edge) ||
          typeof teryt !== "string" ||
          teryt.length <= 2 ||
          !isSameRun(edge.data as EdgeLike, district.data as EdgeLike)
        ) {
          continue;
        }
        const inside =
          office === "Parlament Europejski" ||
          (typeof districtTeryt === "string" &&
            teryt.startsWith(districtTeryt));
        (inside ? contradicting : elsewhere).push(edge);
      }
      for (const [reason, left] of [
        ["home in another województwo", elsewhere],
        ["copies disagree", contradicting],
      ] as const) {
        if (left.length === 0) continue;
        skipped.push({
          reason,
          personId,
          office,
          startDate,
          ids: [district.id, ...left.map((edge) => edge.id)],
        });
      }

      if (copies.length > 1) {
        const all = new Set([...copies, ...copies.flatMap(homesOf)]);
        if (all.size > copies.length) {
          skipped.push({
            reason: "several district copies",
            personId,
            office,
            startDate,
            ids: [...all].sort(byId).map((edge) => edge.id),
          });
        }
        continue;
      }
      if (homes.length > 0) found.push({ district, office, startDate, homes });
    }

    // A copy at home that two runs both take - an office-less 2023 one beside
    // a Sejm and a Senate run, which nobody stands for at once - is neither's.
    const takenBy = new Map<string, number>();
    for (const run of found) {
      for (const home of run.homes) {
        takenBy.set(home.id, (takenBy.get(home.id) ?? 0) + 1);
      }
    }

    for (const { district, office, startDate, homes } of found) {
      const ids = [district, ...homes].map((edge) => edge.id);
      const skip = (reason: SkipReason) =>
        skipped.push({ reason, personId, office, startDate, ids });

      if (homes.some((home) => (takenBy.get(home.id) ?? 0) > 1)) {
        skip("copy fits two runs");
        continue;
      }
      const copies = [district, ...homes];
      if (
        copies.some((a, i) =>
          copies.slice(i + 1).some((b) => disagree(a.data, b.data)),
        )
      ) {
        skip("copies disagree");
        continue;
      }

      const liveHome = homes.find((home) => home.data.published === true);
      const keep =
        district.data.published === true || !liveHome ? district : liveHome;
      const removed = copies.filter((copy) => copy !== keep);

      const before = withoutInternalFields(keep.data);
      const after: Record<string, unknown> = {
        ...before,
        target: district.data.target,
      };
      const learns: Record<string, unknown> = {};
      for (const copy of [district, ...homes]) {
        if (copy === keep) continue;
        for (const [key, value] of Object.entries(
          withoutInternalFields(copy.data),
        )) {
          if (PLACE_FIELDS.has(key) || blank(value) || !blank(after[key])) {
            continue;
          }
          after[key] = value;
          learns[key] = value;
        }
      }
      const data = sameStoredValue(after, before) ? null : after;
      const published = keep.data.published === true;
      if (!published && Object.keys(learns).length > 0) {
        skip("draft would learn");
        continue;
      }

      plans.push({
        personId,
        office,
        startDate,
        districtId: String(district.data.target),
        keep: keep.id,
        movedFrom: keep === district ? null : String(keep.data.target),
        published,
        data,
        learns,
        remove: removed.map((copy) => copy.id),
      });
    }
  }
  return { plans, skipped };
}

/** Why a copy went, on the copy - where somebody finding it removed a year from
 * now would look. */
export function removalReason(plan: RunPlan): string {
  return (
    `Duplikat: ta sama kandydatura (${plan.office}, ${plan.startDate.slice(0, 4)}) ` +
    "była zapisana dwa razy, pod miejscem zamieszkania kandydata i pod " +
    `województwem okręgu. Zostaje powiązanie ${plan.keep}.`
  );
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

/** The revisions written onto one edge, by id. */
async function revisionsOf(db: Firestore, edgeId: string) {
  return (await db.collection("revisions").where("node_id", "==", edgeId).get())
    .docs;
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  /** At most this many runs, in a stable order, so a first run can do ten and
   * be looked at before the rest follows. */
  const limit = Number(argValue("--limit") ?? Number.POSITIVE_INFINITY);
  if (Number.isNaN(limit) || limit < 1) {
    console.error("--limit takes a positive number of runs.");
    process.exit(1);
  }

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }
  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");
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
  console.info(
    `${edges.size} candidacies and ${teryts.size} regions on the site`,
  );

  const { plans, skipped } = planRuns(
    edges.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    (regionId) => teryts.get(String(regionId)),
  );
  const stored = new Map(edges.docs.map((doc) => [doc.id, doc.data()]));

  // What only reading more than the candidacies can tell: a revision waiting
  // on the live copy that moves, votes cast on a copy that goes, a fact
  // promoted into one. Each holds its run back rather than being guessed at.
  const pendingOnRemoved = new Map<string, string[]>();
  const held: { plan: RunPlan; why: string }[] = [];
  const ready: RunPlan[] = [];
  for (const plan of plans.slice(0, limit)) {
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
    if (why) held.push({ plan, why });
    else ready.push(plan);
  }

  const people = new Map<string, string>();
  const personIds = [
    ...new Set([...plans, ...skipped].map((run) => run.personId)),
  ];
  for (let i = 0; i < personIds.length; i += 100) {
    const docs = await db.getAll(
      ...personIds
        .slice(i, i + 100)
        .map((id) => db.collection("nodes").doc(id)),
    );
    for (const doc of docs) {
      people.set(doc.id, String(doc.data()?.name ?? doc.id));
    }
  }
  const place = (id: string | null) => (id ? (regionNames.get(id) ?? id) : "");

  const moved = ready.filter((plan) => plan.movedFrom);
  const removedCount = ready.reduce((n, plan) => n + plan.remove.length, 0);
  const rejectedCount = ready.reduce(
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
    `  ${ready.length - moved.length} keep the district's copy and remove the one at home`,
  );
  console.info(
    `  ${moved.length} keep the live copy at home, move it to the district and remove the draft there`,
  );
  console.info(
    `  ${removedCount} copies to remove, ${rejectedCount} revisions waiting on them to reject`,
  );
  for (const plan of ready) {
    const learnt = Object.entries(plan.learns)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
    console.info(
      `  ${people.get(plan.personId) ?? plan.personId} (${plan.personId}) ` +
        `${plan.startDate.slice(0, 4)} ${plan.office}: keep ${plan.keep}` +
        (plan.movedFrom
          ? ` [${plan.published ? "live" : "draft"}], moved ${place(plan.movedFrom)} -> ${place(plan.districtId)}`
          : ` [${plan.published ? "live" : "draft"}] in ${place(plan.districtId)}`) +
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
        `    ${people.get(run.personId) ?? run.personId} (${run.personId}) ` +
          `${run.startDate.slice(0, 4)} ${run.office}: ${run.ids.join(", ")}`,
      );
    }
  }
  for (const { plan, why } of held) {
    console.info(
      `  held: ${plan.personId} ${plan.startDate.slice(0, 4)} ${plan.office}: ${why}`,
    );
  }

  if (!commit) {
    reportRemaining({ runs: ready.length, removed: removedCount });
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  // One batch per run, so no run is left half-folded: a failure stops the
  // script with every run before it whole, and a re-run finishes the job
  // because a folded run has one copy left.
  const user = { uid: AUTHOR };
  let done = 0;
  for (const plan of ready) {
    const batch = db.batch();
    const keepStored = stored.get(plan.keep)!;
    if (plan.data) {
      createRevisionTransaction(
        db,
        batch,
        user,
        db.collection("edges").doc(plan.keep),
        plan.data,
        // Approved, as the correction it is; `stored` carries `published`
        // and the rest of what the document owns across.
        { automatic: true, approve: true, stored: keepStored },
      );
    }
    const reason = removalReason(plan);
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
          user: AUTHOR,
          reason,
        },
        batch,
      );
      const rejectReason = `Zastąpiona: ta sama kandydatura jest w powiązaniu ${plan.keep}.`;
      for (const revisionId of pendingOnRemoved.get(id) ?? []) {
        batch.update(db.collection("revisions").doc(revisionId), {
          status: "rejected",
          reject_reason: rejectReason,
          review_user: AUTHOR,
          review_time: Timestamp.now(),
        });
        recordAudit(
          db,
          {
            action: "reject",
            collection: "edges",
            target_id: id,
            revision_id: revisionId,
            user: AUTHOR,
            reason: rejectReason,
          },
          batch,
        );
      }
    }
    await batch.commit();
    done++;
  }
  console.info(`\nFolded ${done} runs.`);
  console.info(
    "Re-run the dry run: it must report 0 runs. The pages update when their " +
      "six-hour cache turns over.",
  );
}

// Importable by the tests, which check the planning without Firestore. Same
// guard as `fix-stale-seats.ts`.
if (process.argv[1]?.endsWith("merge-national-runs-stored-twice.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
