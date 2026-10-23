import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  isDistrictOffice,
  isSameRun,
  misfiledRunOf,
  type EdgeLike,
} from "../../../server/utils/edges";
import {
  argValue,
  byId,
  disagree,
  fold,
  holdBack,
  namesOf,
  printPlans,
  writeFold,
  type RunPlan,
  type SkippedRun,
  type StoredEdge,
} from "../fold-candidacies";
import { reportRemaining } from "../remaining";

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
 *     scripts/migrate/archive/merge-national-runs-stored-twice.ts                  # dry run, emulator
 *   ... merge-national-runs-stored-twice.ts --commit                       # apply, emulator
 *   ... merge-national-runs-stored-twice.ts --prod                         # dry run, PRODUCTION
 *   ... merge-national-runs-stored-twice.ts --prod --commit --limit 10     # the first ten
 *   ... merge-national-runs-stored-twice.ts --prod --commit
 */

const AUTHOR = "migration:merge-national-runs-stored-twice";

/** Why a run stored twice is left for a person rather than folded. */
export type SkipReason =
  | "home in another województwo"
  | "copies disagree"
  | "several district copies"
  | "copy fits two runs"
  | "draft would learn";

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

      const folded = fold(district, homes);
      if (folded === "draft would learn") {
        skip(folded);
        continue;
      }

      plans.push({
        personId,
        office,
        startDate,
        placeId: String(district.data.target),
        ...folded,
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
  const { ready, held, pendingOnRemoved } = await holdBack(
    db,
    plans.slice(0, limit),
    stored,
  );
  const people = await namesOf(
    db,
    [...plans, ...skipped].map((run) => run.personId),
  );
  const { removed } = printPlans(
    plans,
    ready,
    held,
    skipped,
    pendingOnRemoved,
    people,
    regionNames,
    limit,
  );

  if (!commit) {
    reportRemaining({ runs: ready.length, removed });
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  // One batch per run, so no run is left half-folded: a failure stops the
  // script with every run before it whole, and a re-run finishes the job
  // because a folded run has one copy left.
  let done = 0;
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
