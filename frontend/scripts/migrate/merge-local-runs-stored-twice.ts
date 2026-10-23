import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  isLocalOffice,
  unnamedLocal,
  type EdgeLike,
} from "../../server/utils/edges";
import { electionKindsIn } from "../../shared/electionDays";
import { placesAgree } from "../../shared/twoPlaces";
import {
  argValue,
  byId,
  disagree,
  fold,
  holdBack,
  namesOf,
  printPlans,
  revisionsOf,
  writeFold,
  type RunPlan,
  type SkippedRun,
  type StoredEdge,
} from "./fold-candidacies";
import { reportRemaining } from "./remaining";

/**
 * Fold a local candidacy stored as „Samorząd” into the copy of the same run
 * that names its office.
 *
 * Every upload before the pipeline named the office stored a local run as
 * „Samorząd”, and every upload before 2026-07-30 could file it under the
 * candidate's home rather than where it was stood (df49f43e). Payloads now
 * send the office and the place. Where the ingest found the „Samorząd” copy it
 * named it in place (`specifies` in server/utils/edges.ts). Where it did not -
 * a sejmik run at home, since the ingest looks under the payload's region only,
 * or a run stored twice by an upload that sent the run-off as a row of its
 * own - it stored the named run beside it. Michał Jerzy Sobczak's 2024 sejmik
 * run is live as „Samorząd” under Łódź beside a draft „Sejmik” under łódzkie.
 *
 * A „Samorząd” copy beside a named one is not always that, though. Nobody
 * stands for two councils in one election, but a council and a mayoral run in
 * one town are two candidacies (repeated-local-candidacies-are-two-runs), and
 * where only one of the two has its office written yet, the other is a real
 * run still waiting for its name. So PKW decides, as the payload states it
 * (`--pkw`, written by data/pipelines' scripts.payload_elections): a
 * „Samorząd” copy is folded only where every local run PKW records for the
 * person that year already has a named copy, so the „Samorząd” one can be
 * none but a second copy of one of them. Rehearsed on an emulator loaded
 * with the 2026-10-23 export, against that night's people_enriched: 266 runs
 * folded (194 keep the named copy, 72 move a live „Samorząd” copy into place
 * and name it), 268 copies removed, 80 waiting revisions rejected, and a second
 * dry run found nothing. Left for a person: 62 runs not yet named, 8 copies
 * with no named one in their place, 7 years with more named copies than PKW
 * runs, 2 people PKW has no record of.
 *
 * WHICH COPIES:
 *   - the „Samorząd” copy: a live candidacy whose office says „Samorząd”, or
 *     says nothing in a year that held only local elections, filed under a
 *     powiat or a gmina;
 *   - the named copy: a live candidacy naming a local office, or a
 *     „Samorząd”/office-less one filed under a województwo - the one local
 *     office elected by a whole województwo is its sejmik;
 *   - the „Samorząd” copy folds into a named copy in its place: the same
 *     region, or the województwo it lies in, for a sejmik run filed at home.
 *     Several named copies there: the one of the same region, then the one
 *     agreeing about the result, then by id.
 *
 * Folded as merge-national-runs-stored-twice.ts folds a run (fold-candidacies.ts):
 * the live copy stays, the named one where both or neither are; a live
 * „Samorząd” copy keeping its place on the page takes the named copy's office,
 * committee and result, and moves to its region. The named copy never learns
 * the office or the result from the „Samorząd” one: those are what the old
 * upload got wrong (clear-wins-written-onto-lost-mayoral-runs).
 *
 * WHAT IT LEAVES ALONE, and reports:
 *   - a person PKW has no record of in `--pkw`, or a year whose run PKW names
 *     no office for;
 *   - a year with a PKW run no named copy stands for: the „Samorząd” copy may
 *     be it;
 *   - more named copies than PKW has runs: a duplicate of another shape;
 *   - a „Samorząd” copy with no named copy in its place, or one that disagrees
 *     with it, or one saying the run was won where PKW says it was lost;
 *   - a draft kept that would learn something (a reviewer's to approve);
 *   - and, read off the revisions: a „Samorząd” copy at home somebody added
 *     by hand rather than an upload, or one with a proposal waiting for review
 *     - a pipeline proposal there is the ingest naming it as a run of its own.
 *
 * Make the PKW file from the newest people_enriched backup first (the
 * commands are in data/pipelines/src/scripts/payload_elections.py), then, from
 * frontend/:
 *   npx tsx --tsconfig .nuxt/tsconfig.server.json \
 *     scripts/migrate/merge-local-runs-stored-twice.ts --pkw <file>                   # dry run, emulator
 *   ... merge-local-runs-stored-twice.ts --pkw <file> --commit                        # apply, emulator
 *   ... merge-local-runs-stored-twice.ts --pkw <file> --prod                          # dry run, PRODUCTION
 *   ... merge-local-runs-stored-twice.ts --pkw <file> --prod --commit --limit 10      # the first ten
 *   ... merge-local-runs-stored-twice.ts --pkw <file> --prod --commit
 */

const AUTHOR = "migration:merge-local-runs-stored-twice";

/** The office of a local candidacy nothing named. */
const UNNAMED = "Samorząd";

/** One local run PKW records for a person, as the payload states it. */
export type PkwRun = {
  office: string;
  year: string;
  teryt: string | null;
  elected: boolean | null;
};

/** Why a „Samorząd” copy is left for a person rather than folded. */
export type SkipReason =
  | "no PKW record"
  | "PKW names no office"
  | "a run not yet named"
  | "more named copies than PKW runs"
  | "no named copy in its place"
  | "copies disagree"
  | "won here, lost in PKW"
  | "draft would learn";

/** Whether a candidacy says no more than that it was local (`unnamedLocal`). */
function unnamed(edge: StoredEdge): boolean {
  return unnamedLocal(edge.data as EdgeLike);
}

/** The office a candidacy stands for, if it names one or its place does: a
 * „Samorząd” run under a województwo is its sejmik. */
function officeOf(
  edge: StoredEdge,
  teryt: string | undefined,
): string | undefined {
  if (isLocalOffice(edge.data.position)) return edge.data.position;
  if (unnamed(edge) && teryt?.length === 2) return "Sejmik";
  return undefined;
}

/** A „Samorząd” value says nothing: the named office takes its place. */
const says = (key: string, value: unknown) =>
  !(key === "position" && value === UNNAMED);

/** What the copy in place never learns from a „Samorząd” copy. */
const OWNED_BY_PLACE: ReadonlySet<string> = new Set(["position", "elected"]);

/** What to do with every local run stored twice among `edges`: the person's
 * candidacies, read whole. Pure, so the dry run, the run and the tests reason
 * the same way. `terytOf` answers a region's TERYT code by its id, `pkwOf` a
 * person's local runs by their page's id, or undefined for a person PKW has
 * no record of. */
export function planLocalRuns(
  edges: readonly StoredEdge[],
  terytOf: (regionId: unknown) => string | undefined,
  pkwOf: (personId: string) => readonly PkwRun[] | undefined,
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
    const byDate = new Map<string, StoredEdge[]>();
    for (const edge of [...byPerson.get(personId)!].sort(byId)) {
      const date = edge.data.start_date;
      if (typeof date !== "string" || !date) continue;
      if (!electionKindsIn(date.slice(0, 4)).includes("local")) continue;
      byDate.set(date, [...(byDate.get(date) ?? []), edge]);
    }

    for (const [startDate, copies] of byDate) {
      const atHome = copies.filter((edge) => {
        const teryt = terytOf(edge.data.target);
        return unnamed(edge) && typeof teryt === "string" && teryt.length > 2;
      });
      const named = copies.filter(
        (edge) => officeOf(edge, terytOf(edge.data.target)) !== undefined,
      );
      if (atHome.length === 0 || named.length === 0) continue;

      const ids = [...named, ...atHome].map((edge) => edge.id);
      const skip = (reason: SkipReason, office = "Samorząd", these = ids) =>
        skipped.push({ reason, personId, office, startDate, ids: these });

      const pkw = pkwOf(personId);
      if (!pkw) {
        skip("no PKW record");
        continue;
      }
      const year = startDate.slice(0, 4);
      const runs = pkw.filter(
        (run) =>
          run.year === year &&
          (isLocalOffice(run.office) || run.office === UNNAMED),
      );
      if (runs.some((run) => run.office === UNNAMED)) {
        skip("PKW names no office");
        continue;
      }

      // Each PKW run onto a named copy of its office, in its place.
      const runOf = new Map<string, PkwRun>();
      let unmatched = false;
      for (const run of runs) {
        const copy = named.find((edge) => {
          const teryt = terytOf(edge.data.target);
          return (
            !runOf.has(edge.id) &&
            officeOf(edge, teryt) === run.office &&
            (!run.teryt || (!!teryt && placesAgree(teryt, run.teryt)))
          );
        });
        if (copy) runOf.set(copy.id, run);
        else unmatched = true;
      }
      if (unmatched) {
        skip("a run not yet named");
        continue;
      }
      if (named.length > runs.length) {
        skip("more named copies than PKW runs");
        continue;
      }

      // Each „Samorząd” copy onto the named copy in its place.
      const into = new Map<string, StoredEdge[]>();
      for (const home of atHome) {
        const homeTeryt = terytOf(home.data.target) ?? "";
        const candidates = named
          .filter((edge) => {
            const teryt = terytOf(edge.data.target);
            return (
              typeof teryt === "string" &&
              homeTeryt.startsWith(teryt) &&
              !disagree(home.data, edge.data, says)
            );
          })
          .sort((a, b) => {
            const rank = (edge: StoredEdge) => [
              edge.data.target === home.data.target ? 0 : 1,
              (edge.data.elected === true) === (home.data.elected === true)
                ? 0
                : 1,
            ];
            const [a0, a1] = rank(a);
            const [b0, b1] = rank(b);
            return a0! - b0! || a1! - b1! || byId(a, b);
          });
        const copy = candidates[0];
        if (!copy) {
          skip("no named copy in its place", "Samorząd", [home.id]);
          continue;
        }
        if (
          home.data.elected === true &&
          runOf.get(copy.id)?.elected === false
        ) {
          skip("won here, lost in PKW", runOf.get(copy.id)!.office, [
            copy.id,
            home.id,
          ]);
          continue;
        }
        into.set(copy.id, [...(into.get(copy.id) ?? []), home]);
      }

      for (const [placeId, homes] of into) {
        const place = named.find((edge) => edge.id === placeId)!;
        const office = officeOf(place, terytOf(place.data.target))!;
        const all = [place, ...homes];
        if (
          all.some((a, i) =>
            all.slice(i + 1).some((b) => disagree(a.data, b.data, says)),
          )
        ) {
          skip(
            "copies disagree",
            office,
            all.map((edge) => edge.id),
          );
          continue;
        }
        const folded = fold(place, homes, {
          says,
          ownedByPlace: OWNED_BY_PLACE,
        });
        if (folded === "draft would learn") {
          skip(
            folded,
            office,
            all.map((edge) => edge.id),
          );
          continue;
        }
        plans.push({
          personId,
          office,
          startDate,
          placeId: String(place.data.target),
          ...folded,
        });
      }
    }
  }
  return { plans, skipped };
}

/** Why a copy went, on the copy. */
export function removalReason(plan: RunPlan): string {
  return (
    `Duplikat: ta sama kandydatura (${plan.office}, ${plan.startDate.slice(0, 4)}) ` +
    "była zapisana dwa razy, raz jako „Samorząd”, bez nazwy urzędu. " +
    `Zostaje powiązanie ${plan.keep}.`
  );
}

/** The register entry a rejestr.io link names: `registerEntry` in
 * server/api/ingest/person.post.ts. */
function registerEntry(link: unknown): string | undefined {
  if (typeof link !== "string" || !link) return undefined;
  return /rejestr\.io\/osoby\/(\d+)/.exec(link)?.[1] ?? link;
}

/** PKW's local runs from a `scripts.payload_elections` file: by page id, and
 * by register entry for a page PeopleKorytaMerged did not match. */
export function readPkw(text: string): {
  byPage: Map<string, PkwRun[]>;
  byEntry: Map<string, PkwRun[]>;
} {
  const byPage = new Map<string, PkwRun[]>();
  const byEntry = new Map<string, PkwRun[]>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      korytaId?: string | null;
      rejestrIo?: string[];
      elections?: {
        election_type?: string;
        election_year?: string;
        teryt?: string | null;
        elected?: boolean | null;
      }[];
    };
    const runs: PkwRun[] = (row.elections ?? []).map((election) => ({
      office: String(election.election_type ?? ""),
      year: String(election.election_year ?? ""),
      teryt: election.teryt ?? null,
      elected: election.elected ?? null,
    }));
    if (row.korytaId) add(byPage, row.korytaId, runs);
    for (const entry of row.rejestrIo ?? []) add(byEntry, entry, runs);
  }
  return { byPage, byEntry };
}

/** Adds a row's runs to what is known of a person, once each. A person can
 * have two rows - a register entry the odpisy give a second PESEL - and a run
 * counted twice would read as a run with no named copy. Nobody stands for one
 * office in one place twice in an election, so that is what one run is. */
function add(index: Map<string, PkwRun[]>, key: string, runs: PkwRun[]) {
  const known = index.get(key) ?? [];
  for (const run of runs) {
    const same = known.find(
      (other) =>
        other.office === run.office &&
        other.year === run.year &&
        other.teryt === run.teryt,
    );
    if (!same) known.push({ ...run });
    else if (run.elected === true) same.elected = true;
  }
  index.set(key, known);
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const pkwFile = argValue("--pkw");
  /** At most this many runs, in a stable order, so a first run can do ten and
   * be looked at before the rest follows. */
  const limit = Number(argValue("--limit") ?? Number.POSITIVE_INFINITY);
  if (!pkwFile) {
    console.error(
      "--pkw <file> is required: PKW's runs, from data/pipelines' scripts.payload_elections.",
    );
    process.exit(1);
  }
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

  const pkw = readPkw(readFileSync(pkwFile, "utf8"));
  console.info(
    `PKW: ${pkw.byPage.size} pages, ${pkw.byEntry.size} register entries in ${pkwFile}`,
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
  const people = await db
    .collection("nodes")
    .where("type", "==", "person")
    .get();
  const entryOf = new Map(
    people.docs.map((doc) => [doc.id, registerEntry(doc.data().rejestrIo)]),
  );
  const edges = await db
    .collection("edges")
    .where("type", "==", "election")
    .get();
  console.info(
    `${edges.size} candidacies, ${people.size} people and ${teryts.size} regions on the site`,
  );

  const { plans, skipped } = planLocalRuns(
    edges.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    (regionId) => teryts.get(String(regionId)),
    (personId) => {
      const entry = entryOf.get(personId);
      return (
        pkw.byPage.get(personId) ?? (entry ? pkw.byEntry.get(entry) : undefined)
      );
    },
  );
  const stored = new Map(edges.docs.map((doc) => [doc.id, doc.data()]));

  // The „Samorząd” copies at home an upload did not write, and the ones the
  // ingest has since named as runs of their own: a pipeline proposal waiting
  // on one. Only the copies at home are asked. A draft's own creation revision
  // waits for review too, but it is no proposal, and the copy under a
  // województwo standing in for the sejmik's is the run's place, not the
  // question.
  const { ready, held, pendingOnRemoved } = await holdBack(
    db,
    plans.slice(0, limit),
    stored,
    async (plan) => {
      for (const id of [plan.keep, ...plan.remove]) {
        const copy = stored.get(id);
        const teryt = teryts.get(String(copy?.target));
        if (
          !copy ||
          !unnamed({ id, data: copy }) ||
          !teryt ||
          teryt.length <= 2
        ) {
          continue;
        }
        const revisions = (await revisionsOf(db, id)).map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as {
          id: string;
          status?: unknown;
          update_time?: { toMillis?: () => number } | string;
          update_automatic?: unknown;
        }[];
        const proposal = revisions.find(
          (revision) =>
            revision.id.startsWith("proposal_") &&
            revision.status === "pending",
        );
        if (proposal) {
          return `a proposal waits for review on the „Samorząd” copy ${id} (${proposal.id})`;
        }
        const time = (revision: (typeof revisions)[number]) =>
          typeof revision.update_time === "object" &&
          revision.update_time.toMillis
            ? revision.update_time.toMillis()
            : String(revision.update_time ?? "");
        const first = revisions
          .filter((revision) => !revision.id.startsWith("proposal_"))
          .sort((a, b) =>
            time(a) < time(b) ? -1 : time(a) > time(b) ? 1 : 0,
          )[0];
        if (first && first.update_automatic === false) {
          return `the „Samorząd” copy ${id} was added by hand`;
        }
      }
      return undefined;
    },
  );
  const names = await namesOf(
    db,
    [...plans, ...skipped].map((run) => run.personId),
  );
  const { removed } = printPlans(
    plans,
    ready,
    held,
    skipped,
    pendingOnRemoved,
    names,
    regionNames,
    limit,
  );

  if (!commit) {
    reportRemaining({ runs: ready.length, removed });
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  // One batch per run, as merge-national-runs-stored-twice.ts writes them.
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

// Importable by the tests, which check the planning without Firestore.
if (process.argv[1]?.endsWith("merge-local-runs-stored-twice.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
