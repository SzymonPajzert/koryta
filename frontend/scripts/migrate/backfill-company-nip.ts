import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { isValidNip, isValidRegon } from "../../shared/identifiers";

/**
 * One-time migration: give every company node the NIP and REGON that KRS
 * already knows, so that a register keyed on NIP can be joined to this site.
 *
 * `Company` has carried `nipNumber` and `regonNumber` since the hospitals
 * arrived - a ministry or an urząd registers with no court and so has no KRS at
 * all - but nothing ever wrote them. Measured against the production export of
 * 2026-09-14: **5 of 4 928 place nodes carry a NIP**, against 4 837 that carry
 * a KRS number.
 *
 * That is the whole difference between the contracts feature working and the
 * contracts feature being empty. CRU identifies every party by NIP and REGON
 * and carries no KRS anywhere, so with the nodes as they stand the register's
 * 149 683 contracts join to **27** of them. With this backfill applied they
 * join to **13 333**, touching 825 companies. Run it before, or in the same
 * release as, the first contract ingest.
 *
 * The mapping is free: `companies_merged`, which the pipelines already build
 * from api-krs and rejestr.io, holds a KRS -> NIP/REGON pair for 15 719 of its
 * 17 107 rows, and 4 701 of the site's 4 837 KRS companies are in it.
 *
 * Getting the file:
 *
 *   # either from a local pipeline run
 *   cd data/pipelines && uv run --frozen koryta Companies --no-backup
 *   # or from the shared cache, which is far quicker
 *   gsutil cp "gs://koryta-pl-sharedcache/filename=companies_merged/user=romb/datetime=<ts>/backup.tar.gz" .
 *   tar xzf backup.tar.gz            # yields a jsonl file named `companies_merged`
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-company-nip.ts --source <file>
 *   npx tsx scripts/migrate/backfill-company-nip.ts --source <file> --commit
 * Against production:
 *   npx tsx scripts/migrate/backfill-company-nip.ts --source <file> --prod --commit
 *
 * Only `nipNumber` and `regonNumber` are written, and only where the node has
 * neither - a value already on the node was put there by a human through
 * `companyEditSchema` and outranks the register. No revision is recorded, for
 * the reason `create-region-nodes.ts` gives for regions: an identifier copied
 * out of the court register is not a claim anybody argues about, and 4 700
 * revisions saying so would bury the queue that reviewers actually read.
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const sourceAt = process.argv.indexOf("--source");
const sourcePath = sourceAt === -1 ? undefined : process.argv[sourceAt + 1];

if (!sourcePath) {
  console.error(
    "Pass --source <companies_merged jsonl>. See the docstring for where to get one.",
  );
  process.exit(1);
}

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Firestore takes 500 operations per batch. */
const BATCH_SIZE = 400;

type MergedCompany = {
  krs?: string | null;
  nip?: string | null;
  regon?: string | null;
};

/** KRS -> the identifiers the register holds for it.
 *
 * Keyed on the KRS as the file spells it, and again zero-padded to ten digits:
 * `companies_merged` is consistent about the padding and the site's nodes are
 * not entirely, and a lookup that misses is indistinguishable from a company
 * the register has never heard of.
 */
function readMergedCompanies(path: string) {
  const byKrs = new Map<string, { nip?: string; regon?: string }>();
  let rows = 0;
  let malformed = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    rows += 1;
    let row: MergedCompany;
    try {
      row = JSON.parse(line) as MergedCompany;
    } catch {
      malformed += 1;
      continue;
    }
    if (!row.krs) continue;
    const identifiers = {
      nip: row.nip ? String(row.nip).trim() : undefined,
      regon: row.regon ? String(row.regon).trim() : undefined,
    };
    if (!identifiers.nip && !identifiers.regon) continue;
    const krs = String(row.krs).trim();
    byKrs.set(krs, identifiers);
    byKrs.set(krs.padStart(10, "0"), identifiers);
  }
  return { byKrs, rows, malformed };
}

async function backfill() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const { byKrs, rows, malformed } = readMergedCompanies(sourcePath!);
  console.log(
    `Read ${rows} row(s) from ${sourcePath}` +
      (malformed ? `, ${malformed} of them unparseable` : "") +
      `; ${byKrs.size / 2} KRS number(s) carry an identifier.`,
  );

  const snapshot = await db
    .collection("nodes")
    .where("type", "==", "place")
    .select("name", "krsNumber", "nipNumber", "regonNumber")
    .get();

  let noKrs = 0;
  let unknownKrs = 0;
  let alreadyHad = 0;
  let invalid = 0;
  const writes: { id: string; name: string; data: Record<string, string> }[] =
    [];

  for (const doc of snapshot.docs) {
    const krs = doc.get("krsNumber") as string | undefined;
    if (!krs) {
      noKrs += 1;
      continue;
    }
    const identifiers = byKrs.get(String(krs).trim());
    if (!identifiers) {
      unknownKrs += 1;
      continue;
    }

    const data: Record<string, string> = {};
    if (!doc.get("nipNumber") && identifiers.nip) {
      // A check digit rather than a length test: the register is not the only
      // thing that has ever put a REGON in a NIP column, and a wrong NIP here
      // would join contracts to the wrong company - the one failure this
      // feature must not have.
      if (isValidNip(identifiers.nip)) data.nipNumber = identifiers.nip;
      else invalid += 1;
    }
    if (!doc.get("regonNumber") && identifiers.regon) {
      if (isValidRegon(identifiers.regon)) data.regonNumber = identifiers.regon;
      else invalid += 1;
    }

    if (Object.keys(data).length === 0) {
      if (doc.get("nipNumber") || doc.get("regonNumber")) alreadyHad += 1;
      continue;
    }
    writes.push({
      id: doc.id,
      name: (doc.get("name") as string | undefined) ?? doc.id,
      data,
    });
  }

  console.log(
    `${snapshot.size} company node(s): ${writes.length} to update, ` +
      `${alreadyHad} already carried an identifier, ${unknownKrs} not in the ` +
      `register file, ${noKrs} with no KRS number at all` +
      (invalid ? `, ${invalid} identifier(s) failed their check digit` : "") +
      ".",
  );

  for (const write of writes.slice(0, 5)) {
    console.log(`  e.g. ${write.name}: ${JSON.stringify(write.data)}`);
  }

  if (!commit) {
    console.log("Dry run — nothing written.");
    return;
  }

  for (let at = 0; at < writes.length; at += BATCH_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(at, at + BATCH_SIZE)) {
      batch.update(db.collection("nodes").doc(write.id), write.data);
    }
    await batch.commit();
    console.log(
      `Wrote ${Math.min(at + BATCH_SIZE, writes.length)}/${writes.length}`,
    );
  }
  console.log("Done.");
}

backfill().catch((error) => {
  console.error(error);
  process.exit(1);
});
