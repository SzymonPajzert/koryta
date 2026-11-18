import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { candidacyElection } from "../../shared/electionDays";
import { committeeKey } from "../../shared/electionLists";
import { namesAgree } from "../../shared/names";
import { createSlug } from "../../shared/slugs";
import type {
  GovernmentCouncil,
  GovernmentHead,
  GovernmentPerson,
  RegionGovernment,
} from "../../shared/model";
import { withoutInternalFields } from "../../server/utils/revisions";
import { reportRemaining } from "./remaining";

/**
 * Fill each region's „Władze” (`Region.authorities`) from PKW's results of the
 * 2024 local elections: the wójt, burmistrz or prezydent, and every council's
 * members, by name.
 *
 * Szymon, 2026-11-18, on board round region-lists-r2: "Even if they are not on
 * the page, they should just be listed for the information. The region should
 * have editable parts so it's filled by PKW but if the burmistrz changes for
 * some reason, volunteers can change this information themselves". He chose
 * the region's own record over pages for the 49,000 winners, and the names of
 * heads and councillors alike.
 *
 * The input is what `data/pipelines` writes with
 * `scripts/region_authorities.py` over the PeoplePKW output: one record per
 * region node id. A winner is linked to a person page where the site stores
 * their 2024 run as won: a run of the same committee, filed where the night
 * files that election (a gmina's on its powiat), whose person's name agrees
 * with PKW's (`namesAgree`) and whose birth date does not contradict PKW's
 * birth year. One such page, or none: two leave the name unlinked.
 *
 * Each region gets a revision by this script, approved, holding the region as
 * stored plus the record, and the node's `authorities` and `revision_id` are
 * set to it - so a contributor's first proposal reads as a change to the
 * record, not as a new entry. No region had a revision before (2026-11-18);
 * 405 pointed `revision_id` at a document that does not exist, which this
 * repairs for each region it writes.
 *
 * LEFT ALONE, and reported: a region whose record a person has changed
 * (`authoritiesSource: "manual"`), a region whose record already says what the
 * file does, and the records with no region node - about 1,500 gminy and
 * districts have no page yet. A city's „Gmina X” twin is in the file under
 * the city, and is not written.
 *
 * Like every script here it cannot clear the Nitro handler cache: a region
 * page shows the old record for up to six hours.
 *
 * Usage, from frontend/, against the running emulator:
 *   npx tsx scripts/migrate/seed-region-authorities.ts --input <file>            # dry run
 *   npx tsx scripts/migrate/seed-region-authorities.ts --input <file> --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/seed-region-authorities.ts --input <file> --prod
 *   npx tsx scripts/migrate/seed-region-authorities.ts --input <file> --prod --commit
 */

const AUTHOR = "migration:seed-region-authorities";

/** A winner as the file gives them: the record's fields, and what a match
 * reads. */
export interface SeedPerson extends GovernmentPerson {
  firstName?: string;
  lastName?: string;
  birthYear?: number;
}

export interface SeedRecord {
  election: string;
  head?: SeedPerson & { office: string; member?: string };
  councils: { office: string; seats: number; members: SeedPerson[] }[];
}

/** A won 2024 run on the site, with its person. */
export interface WonRun {
  personId: string;
  personName: string;
  /** The person's birth date, `YYYY-MM-DD`, where the page has one. */
  birthDate?: string;
  /** Where the run is filed: `teryt1005` for a gmina's. */
  target: string;
  committee: string;
}

/** The nodes a region's winners' runs may be filed on: the region itself and,
 * for a gmina or a district, its powiat, where the night files them. */
export function filingTargets(regionId: string): string[] {
  const code = regionId.replace(/^teryt/, "");
  return code.length === 7
    ? [regionId, `teryt${code.slice(0, 4)}`]
    : [regionId];
}

function committeeSlug(committee: string): string {
  return createSlug(committeeKey(committee));
}

/** The runs, by where they are filed and the committee they were won on. */
export function indexRuns(runs: readonly WonRun[]): Map<string, WonRun[]> {
  const index = new Map<string, WonRun[]>();
  for (const run of runs) {
    const key = `${run.target}|${committeeSlug(run.committee)}`;
    const list = index.get(key);
    if (list) list.push(run);
    else index.set(key, [run]);
  }
  return index;
}

/** The page a winner is, or undefined where none or more than one could be. */
export function matchPerson(
  person: SeedPerson,
  regionId: string,
  runs: Map<string, WonRun[]>,
): string | undefined {
  if (!person.committee) return undefined;
  const slug = committeeSlug(person.committee);
  const pages = new Set<string>();
  for (const target of filingTargets(regionId)) {
    for (const run of runs.get(`${target}|${slug}`) ?? []) {
      if (!namesAgree(run.personName, person.name)) continue;
      const born = Number(run.birthDate?.slice(0, 4));
      if (born && person.birthYear && Math.abs(born - person.birthYear) > 1) {
        continue;
      }
      pages.add(run.personId);
    }
  }
  return pages.size === 1 ? [...pages][0] : undefined;
}

/** A winner as the record stores them: no match fields, the page where one
 * was found. */
function stored(person: SeedPerson, personId: string | undefined) {
  return {
    name: person.name,
    ...(personId ? { personId } : {}),
    ...(person.committee ? { committee: person.committee } : {}),
    ...(person.committeeParties?.length
      ? { committeeParties: person.committeeParties }
      : {}),
  } satisfies GovernmentPerson;
}

/** The record for a region, its winners matched to pages. */
export function recordFor(
  regionId: string,
  seed: SeedRecord,
  runs: Map<string, WonRun[]>,
): { record: RegionGovernment; linked: number; named: number } {
  let linked = 0;
  let named = 0;
  const link = (person: SeedPerson) => {
    named += 1;
    const personId = matchPerson(person, regionId, runs);
    if (personId) linked += 1;
    return stored(person, personId);
  };
  const head: GovernmentHead | undefined = seed.head
    ? {
        ...link(seed.head),
        office: seed.head.office,
        ...(seed.head.member ? { member: seed.head.member } : {}),
      }
    : undefined;
  const councils: GovernmentCouncil[] = seed.councils.map((council) => ({
    office: council.office,
    seats: council.seats,
    members: council.members.map(link),
  }));
  return {
    record: {
      election: seed.election,
      ...(head ? { head } : {}),
      councils,
    },
    linked,
    named,
  };
}

/** The same record however its keys were ordered. */
export function sameRecord(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
              .sort()
              .map((key) => [
                key,
                canonical((value as Record<string, unknown>)[key]),
              ]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

async function wonRuns(db: FirebaseFirestore.Firestore): Promise<WonRun[]> {
  const snapshot = await db
    .collection("edges")
    .where("type", "==", "election")
    .where("elected", "==", true)
    .get();
  const edges = snapshot.docs
    .map((doc) => doc.data())
    .filter(
      (edge) =>
        edge.deleted !== true &&
        typeof edge.source === "string" &&
        typeof edge.target === "string" &&
        typeof edge.committee === "string" &&
        candidacyElection(edge.start_date, edge.position, edge.by_election) ===
          "local-2024",
    );
  const ids = [...new Set(edges.map((edge) => edge.source as string))];
  const people = new Map<string, FirebaseFirestore.DocumentData>();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids
      .slice(i, i + 100)
      .map((id) => db.collection("nodes").doc(id));
    for (const snap of await db.getAll(...refs)) {
      const data = snap.data();
      if (data?.type === "person" && data.deleted !== true && data.name) {
        people.set(snap.id, data);
      }
    }
  }
  return edges.flatMap((edge) => {
    const person = people.get(edge.source);
    if (!person) return [];
    return [
      {
        personId: edge.source as string,
        personName: person.name as string,
        ...(typeof person.birthDate === "string"
          ? { birthDate: person.birthDate }
          : {}),
        target: edge.target as string,
        committee: edge.committee as string,
      },
    ];
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const isProd = argv.includes("--prod");
  const commit = argv.includes("--commit");
  const inputAt = argv.indexOf("--input");
  const input = inputAt >= 0 ? argv[inputAt + 1] : undefined;
  if (!input) {
    console.error(
      "Usage: seed-region-authorities.ts --input <file> [--commit] [--prod]",
    );
    process.exit(2);
  }
  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }
  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");

  const seeds = JSON.parse(readFileSync(input, "utf8")) as Record<
    string,
    SeedRecord
  >;
  console.info(
    `${Object.keys(seeds).length} records in ${input}, against ` +
      `${isProd ? "PRODUCTION" : "the emulator"}${commit ? "" : " (dry run)"}.`,
  );

  const runs = indexRuns(await wonRuns(db));
  console.info(
    `${[...runs.values()].flat().length} won 2024 runs to match to.`,
  );

  const regions = await db
    .collection("nodes")
    .where("type", "==", "region")
    .get();

  const writes: {
    snapshot: FirebaseFirestore.QueryDocumentSnapshot;
    record: RegionGovernment;
  }[] = [];
  let manual = 0;
  let same = 0;
  let linked = 0;
  let named = 0;
  const written = new Set<string>();
  for (const snapshot of regions.docs) {
    const data = snapshot.data();
    if (data.deleted === true) continue;
    const seed = seeds[snapshot.id];
    if (!seed) continue;
    written.add(snapshot.id);
    if (data.authoritiesSource === "manual") {
      manual += 1;
      continue;
    }
    const result = recordFor(snapshot.id, seed, runs);
    if (sameRecord(data.authorities, result.record)) {
      same += 1;
      continue;
    }
    linked += result.linked;
    named += result.named;
    writes.push({ snapshot, record: result.record });
  }

  console.info(
    `\nRegions with a record: ${written.size} of ${regions.size} region nodes.` +
      `\n  to write: ${writes.length} (${named} people named, ${linked} linked to a page)` +
      `\n  left alone, a person changed the record: ${manual}` +
      `\n  already as the file says: ${same}` +
      `\n  records with no region node: ${Object.keys(seeds).filter((id) => !written.has(id)).length}`,
  );
  for (const { snapshot, record } of writes.slice(0, 5)) {
    console.info(
      `  ${snapshot.id} ${snapshot.data().name}: head ${record.head?.name ?? "-"}, ` +
        `${(record.councils ?? []).map((c) => `${c.office} ${c.members.length}/${c.seats}`).join(", ")}`,
    );
  }

  if (!commit) {
    reportRemaining({ regions: writes.length });
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  let batch = db.batch();
  let pending = 0;
  for (const { snapshot, record } of writes) {
    const revisionRef = db.collection("revisions").doc();
    const now = Timestamp.now();
    batch.set(revisionRef, {
      node_id: snapshot.id,
      collection: "nodes",
      data: { ...withoutInternalFields(snapshot.data()), authorities: record },
      update_time: now,
      update_user: AUTHOR,
      update_automatic: true,
      status: "approved",
      review_user: AUTHOR,
      review_time: now,
    });
    batch.update(
      snapshot.ref,
      { authorities: record, revision_id: revisionRef },
      { lastUpdateTime: snapshot.updateTime },
    );
    pending += 2;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  console.info(
    `\nWrote ${writes.length} regions' records, each with a revision by ${AUTHOR}.`,
  );
  console.info("Re-run the dry run: it must report nothing left to change.");
}

if (process.argv[1]?.endsWith("seed-region-authorities.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
