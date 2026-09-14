import { createRequire, registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import type { Contract, ContractParty } from "../../shared/contracts";
import { normalizeNip, normalizeRegon } from "../../shared/identifiers";

/**
 * Re-run the contract-to-company join for companies whose identifiers the site
 * has learned since the contracts were ingested.
 *
 * `nodeIds`, `buyerNodeId`, `supplierNodeIds`, `linked` and `bothLinked` are
 * decided once, at ingest, against the companies that existed then. That is
 * deliberate - a contract list must not cost one lookup per row - but it means
 * the join goes stale in one direction and stales silently: give a company a
 * NIP today, or add a company the register has been contracting with all
 * along, and every contract it is on still says `linked: false`. Nothing at
 * read time can notice, and the only symptom is „Nasze instytucje" and „Obie
 * strony" quietly under-reporting.
 *
 * This is the repair, and `Contract.nips` is what makes it cheap: the join key
 * is stored beside the join result, so finding the affected documents is one
 * `nips array-contains <identifier>` per company rather than a pass over all
 * 149 683 contracts. Run it after any batch that publishes companies or fills
 * in identifiers - in particular straight after
 * `scripts/migrate/backfill-company-nip.ts`, which gives 4 701 companies a NIP
 * in one go and therefore invalidates the join for every contract they are on.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/relink-contracts.ts --nip 7740001454
 *   npx tsx scripts/migrate/relink-contracts.ts --nip 7740001454 --commit
 * Every company the site holds an identifier for, which is one query each:
 *   npx tsx scripts/migrate/relink-contracts.ts --all --commit
 * Against production:
 *   npx tsx scripts/migrate/relink-contracts.ts --all --prod --commit
 *
 * Only the join fields are written, through `update()` - never `set()`, and
 * never a revision. The subject, the value and the register's own party names
 * are the register's and are not this script's to touch; the lesson that made
 * that a rule is the re-ingest that erased `published` and `stats` off nodes it
 * was only meant to add a field to.
 */

/** Let this script `import()` the server's join, which the Nuxt build resolves
 * `~~/` for and `tsx` does not.
 *
 * The join is imported rather than reimplemented on purpose: a second copy of
 * „which NIPs mean which node, and what counts as both-linked" is a second
 * answer to a question the read path already has one for, and the two would
 * disagree the first time either changed. `scripts/seed-emulator.ts` installs
 * the same hook for the same reason.
 */
// `fileURLToPath(import.meta.url)` and not `__dirname`: `tsx` loads this as
// an ES module, where neither `__dirname` nor `__filename` exists, and the
// reference throws before the script does anything.
const appRoot = resolve(fileURLToPath(import.meta.url), "../../..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("~~/") || specifier.startsWith("~/")) {
      const target = resolve(appRoot, specifier.replace(/^~~?\//, ""));
      return nextResolve(pathToFileURL(target).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const all = process.argv.includes("--all");

/** Every `--nip <n>`, which is repeatable. A REGON works here too: the
 * contract's `nips` array holds both, because CRU identifies a party by
 * whichever of them the institution filed. */
const explicitIdentifiers = process.argv
  .map((arg, at) => (arg === "--nip" ? process.argv[at + 1] : undefined))
  .filter((value): value is string => !!value);

if (explicitIdentifiers.length === 0 && !all) {
  console.error(
    "Pass --nip <identifier> (repeatable), or --all to re-join every company " +
      "the site holds an identifier for. --all is one query per identifier, " +
      "so say it on purpose.",
  );
  process.exit(1);
}

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Every identifier a contract could name this site's companies by.
 *
 * Both forms of the REGON, because a contract stores the nine-digit stem - the
 * one that identifies the legal entity - while a company node may carry the
 * fourteen-digit number of a local unit.
 */
async function siteIdentifiers(db: FirebaseFirestore.Firestore) {
  const snapshot = await db
    .collection("nodes")
    .where("type", "==", "place")
    .select("nipNumber", "regonNumber")
    .get();

  const identifiers = new Set<string>();
  for (const doc of snapshot.docs) {
    const nip = doc.get("nipNumber") as string | undefined;
    if (nip) identifiers.add(normalizeNip(nip));
    const regon = doc.get("regonNumber") as string | undefined;
    if (regon) identifiers.add(normalizeRegon(regon).slice(0, 9));
  }
  console.log(
    `${snapshot.size} company node(s) carry ${identifiers.size} distinct identifier(s).`,
  );
  return [...identifiers];
}

/** The join half of a contract - everything this script is allowed to write. */
type JoinFields = {
  buyer: ContractParty;
  suppliers: ContractParty[];
  nodeIds: string[];
  supplierNodeIds: string[];
  linked: boolean;
  bothLinked: boolean;
  buyerNodeId?: string;
};

function joinOf(contract: Contract): JoinFields {
  return {
    buyer: contract.buyer,
    suppliers: contract.suppliers,
    nodeIds: contract.nodeIds,
    supplierNodeIds: contract.supplierNodeIds,
    linked: contract.linked === true,
    bothLinked: contract.bothLinked === true,
    ...(contract.buyerNodeId ? { buyerNodeId: contract.buyerNodeId } : {}),
  };
}

/** Which node each party resolved to, and nothing else.
 *
 * The comparison is deliberately narrow. A register that restates a party's
 * city or corrects its spelling between ingests is not a reason to rewrite
 * every contract it is on - only a changed link, or a changed name on a link,
 * is something this script has any business fixing.
 */
function joinSignature(join: JoinFields): string {
  const party = (p: ContractParty | undefined) =>
    `${p?.nodeId ?? ""}:${p?.nodeName ?? ""}`;
  return [
    party(join.buyer),
    ...join.suppliers.map(party),
    join.linked,
    join.bothLinked,
  ].join("|");
}

async function relink() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // `createRequire` rather than `await import()`, which eslint bans; either
  // way it has to happen after the resolve hook above is installed.
  const { resolveNodeIds } = createRequire(import.meta.url)(
    "../../server/utils/contracts",
  ) as typeof import("../../server/utils/contracts");

  const identifiers = all
    ? await siteIdentifiers(db)
    : explicitIdentifiers.map((raw) => normalizeNip(raw));

  // Keyed by document id, because one contract can carry two of the
  // identifiers asked about - a consortium of two companies the site
  // describes - and re-resolving it twice would double-count every figure this
  // script prints.
  const found = new Map<string, Contract>();
  for (const identifier of identifiers) {
    const snapshot = await db
      .collection("contracts")
      .where("nips", "array-contains", identifier)
      .get();
    console.log(`${identifier}: ${snapshot.size} contract(s)`);
    for (const doc of snapshot.docs) {
      found.set(doc.id, doc.data() as Contract);
    }
  }

  if (found.size === 0) {
    console.log("No contract carries any of those identifiers. Nothing to do.");
    return;
  }

  // Two parallel arrays rather than an `id` field on the payload: the join
  // takes contract documents as they are written, and a document does not
  // carry its own id. `resolveNodeIds` rewrites them in place, so the „before"
  // signatures have to be taken first.
  const ids = [...found.keys()];
  const documents = ids.map((id) => found.get(id)!);
  const before = documents.map((contract) => joinSignature(joinOf(contract)));
  await resolveNodeIds(db, documents);

  const changed: { id: string; join: JoinFields }[] = [];
  documents.forEach((contract, at) => {
    const join = joinOf(contract);
    if (joinSignature(join) === before[at]) return;
    changed.push({ id: ids[at]!, join });
  });

  console.log(
    `${found.size} contract(s) carry one of those identifiers; ` +
      `${changed.length} of them resolve differently now.`,
  );
  for (const { id, join } of changed.slice(0, 5)) {
    console.log(
      `  e.g. ${id}: linked=${join.linked} bothLinked=${join.bothLinked} ` +
        `nodeIds=${JSON.stringify(join.nodeIds)}`,
    );
  }

  if (!commit) {
    console.log("Dry run — nothing written.");
    return;
  }

  const writer = db.bulkWriter();
  for (const { id, join } of changed) {
    // Arrays go in as they are. `sanitizeFirestoreData` would turn each of
    // them into a numbered-key map, against which `array-contains` matches
    // nothing at all rather than failing - which is the whole reason
    // `asArray` exists in shared/model.ts.
    writer.update(db.collection("contracts").doc(id), {
      buyer: join.buyer,
      suppliers: join.suppliers,
      nodeIds: join.nodeIds,
      supplierNodeIds: join.supplierNodeIds,
      linked: join.linked,
      bothLinked: join.bothLinked,
      // Deleted rather than set to null when the buyer stops resolving: the
      // „jako zamawiający" filter is an equality on this field, and a document
      // holding null would answer a query for null.
      buyerNodeId: join.buyerNodeId ?? FieldValue.delete(),
    });
  }
  await writer.close();
  console.log(`Wrote ${changed.length} contract(s).`);
}

relink().catch((error) => {
  console.error(error);
  process.exit(1);
});
