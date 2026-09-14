import { initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { pageIsPublic } from "../shared/model";
import type {
  ContractCompanyStats,
  ContractCoverage,
} from "../shared/contracts";

/**
 * Recompute every contract aggregate: `contractStats/{nodeId}` and `stats/umowy`.
 *
 * Run it after every contract ingest. Nothing else produces these documents in
 * production - `scripts/seed-emulator.ts` writes them for the emulator, and
 * `/api/ingest/contracts/podsumowanie` accepts them from a caller that has
 * already worked them out - and without them the feature is invisible rather
 * than broken, which is the worse failure of the two:
 *
 * - `/api/contracts/company/[id]` reads `contractStats/{id}` first and returns
 *   `stats: null` when it is missing, and `CompanySection.vue` renders nothing
 *   at all for a null. So every company page would look exactly as it does
 *   today, with the contracts silently absent.
 * - `/umowy` takes every figure in its headline from `stats/umowy`. Without it
 *   the page has no coverage sentence, which is the one thing standing between
 *   „13 333 umowy spośród 149 683" and an unqualified claim about the register.
 *
 * Why a scan rather than counters maintained at ingest: the ingest writes with
 * a `bulkWriter` and a contract can be re-sent, so an increment would double
 * count, and a transaction per contract would serialise 149 683 writes on 825
 * hot documents. A scan is one pass and is idempotent by construction. It costs
 * one read per contract - roughly 13 333 today, 149 683 if the whole register
 * is ingested - which is a few cents and is bounded by how often somebody runs
 * an ingest.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/compute-contract-stats.ts
 *   npx tsx scripts/compute-contract-stats.ts --commit
 * Against production:
 *   npx tsx scripts/compute-contract-stats.ts --prod --commit
 *
 * `--register-total <n>` states how many contracts the register published in
 * the window, which this script cannot know: it can only count what was
 * ingested. Left unset, `total` is set equal to `stored` and the headline says
 * „13 333 umowy spośród 13 333", which is true but says nothing. The pipeline
 * prints the register figure at the end of its run.
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const registerTotalAt = process.argv.indexOf("--register-total");
const registerTotal =
  registerTotalAt === -1
    ? undefined
    : Number(process.argv[registerTotalAt + 1] ?? "");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Firestore takes 500 operations per batch; `contractStats` is one each. */
const BATCH_SIZE = 400;

/** How many contracts one query pulls. Paged rather than read whole: 149 683
 * documents at roughly 2.2 KB each is 330 MB, and this runs in a 1024 MiB
 * container. */
const SCAN_PAGE = 2000;

type Row = {
  buyerNodeId?: string;
  supplierNodeIds?: string[];
  nodeIds?: string[];
  value?: number;
  signedAt?: string;
  publishedAt?: string;
  hasIndividual?: boolean;
  linked?: boolean;
  bothLinked?: boolean;
  buyerNip?: string;
};

/** The median, which travels with every sum this feature prints.
 *
 * Never omitted above n=1: the distribution is p25 384 zł, median 1 436 zł,
 * p90 38 490 zł, maximum 1 105 491 462 zł, so a company's total is usually one
 * contract and a long tail of stationery, and a bold sum on its own reads as
 * typical spend. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

type Accumulator = {
  buyerCount: number;
  buyerValue: number;
  supplierCount: number;
  supplierValue: number;
  values: number[];
  lastSignedAt?: string;
};

function accumulator(): Accumulator {
  return {
    buyerCount: 0,
    buyerValue: 0,
    supplierCount: 0,
    supplierValue: 0,
    values: [],
  };
}

async function compute() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const perCompany = new Map<string, Accumulator>();
  const touched = new Set<string>();
  const buyerNips = new Set<string>();
  let stored = 0;
  let linked = 0;
  let bothLinked = 0;
  let withIndividual = 0;
  let from: string | undefined;
  let to: string | undefined;

  // Ordered by document id, which is the one ordering every document has and
  // which needs no composite index - this walks the whole collection rather
  // than filtering it.
  let cursor: string | undefined;
  for (;;) {
    let query = db
      .collection("contracts")
      .orderBy(FieldPath.documentId())
      .limit(SCAN_PAGE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const row = doc.data() as Row;
      stored += 1;
      if (row.linked) linked += 1;
      if (row.bothLinked) bothLinked += 1;
      if (row.hasIndividual) withIndividual += 1;

      const buyerNip =
        (doc.get("buyer.nip") as string | undefined) ?? undefined;
      if (buyerNip) buyerNips.add(buyerNip);

      const day = row.signedAt ?? row.publishedAt;
      if (day) {
        if (!from || day < from) from = day;
        if (!to || day > to) to = day;
      }

      // A contract with no figure contributes to the counts and to nothing
      // else. Treating it as 0 would pull every median towards zero and
      // understate 825 institutions' spend; 766 contracts in the first window
      // withhold their value under a named legal basis.
      const value = typeof row.value === "number" ? row.value : undefined;

      const seen = new Set<string>();
      if (row.buyerNodeId) {
        const at = perCompany.get(row.buyerNodeId) ?? accumulator();
        at.buyerCount += 1;
        at.buyerValue += value ?? 0;
        if (value !== undefined) at.values.push(value);
        if (day && (!at.lastSignedAt || day > at.lastSignedAt))
          at.lastSignedAt = day;
        perCompany.set(row.buyerNodeId, at);
        touched.add(row.buyerNodeId);
        seen.add(row.buyerNodeId);
      }
      for (const nodeId of row.supplierNodeIds ?? []) {
        // A company that is on both sides of one contract - it happens, a
        // hospital buying a service from another hospital - counts once per
        // role but contributes its value to the median only once.
        const at = perCompany.get(nodeId) ?? accumulator();
        at.supplierCount += 1;
        at.supplierValue += value ?? 0;
        if (value !== undefined && !seen.has(nodeId)) at.values.push(value);
        if (day && (!at.lastSignedAt || day > at.lastSignedAt))
          at.lastSignedAt = day;
        perCompany.set(nodeId, at);
        touched.add(nodeId);
        seen.add(nodeId);
      }
    }

    cursor = snapshot.docs.at(-1)?.id;
    if (snapshot.size < SCAN_PAGE) break;
  }

  console.log(
    `Scanned ${stored} contract(s): ${linked} with an end on a company we ` +
      `describe, ${bothLinked} with both, touching ${touched.size} companies.`,
  );

  // Distinct PEOPLE, not employments, and the difference is large: 900
  // employments on the 825 touched companies are fully published, but they
  // belong to 558 people. „N osób" in the headline has to be the second number.
  const namedPeople = new Set<string>();
  const companyIds = Array.from(touched);
  const publishedCompanies = new Set<string>();
  for (let at = 0; at < companyIds.length; at += 100) {
    const refs = companyIds
      .slice(at, at + 100)
      .map((id) => db.collection("nodes").doc(id));
    for (const snap of await db.getAll(...refs, {
      fieldMask: ["published", "deleted"],
    })) {
      if (snap.exists && pageIsPublic(snap.data() ?? {})) {
        publishedCompanies.add(snap.id);
      }
    }
  }

  const peopleIds = new Set<string>();
  for (let at = 0; at < companyIds.length; at += 30) {
    const snapshot = await db
      .collection("edges")
      .where("target", "in", companyIds.slice(at, at + 30))
      .where("type", "==", "employed")
      .get();
    for (const doc of snapshot.docs) {
      const edge = doc.data() as {
        source?: string;
        target?: string;
        published?: boolean;
        deleted?: boolean;
      };
      if (edge.deleted === true || !edge.source || !edge.target) continue;
      if (edge.published !== true) continue;
      if (!publishedCompanies.has(edge.target)) continue;
      peopleIds.add(edge.source);
    }
  }
  const personIds = Array.from(peopleIds);
  for (let at = 0; at < personIds.length; at += 100) {
    const refs = personIds
      .slice(at, at + 100)
      .map((id) => db.collection("nodes").doc(id));
    for (const snap of await db.getAll(...refs, {
      fieldMask: ["published", "deleted"],
    })) {
      if (snap.exists && pageIsPublic(snap.data() ?? {})) {
        namedPeople.add(snap.id);
      }
    }
  }
  console.log(
    `${namedPeople.size} distinct person(s) may be named to a logged out ` +
      `reader, across ${personIds.length} on a published employment.`,
  );

  const computedAt = new Date().toISOString();
  const companyStats: ContractCompanyStats[] = [];
  for (const [nodeId, at] of perCompany) {
    const stats: ContractCompanyStats = {
      nodeId,
      buyerCount: at.buyerCount,
      buyerValue: at.buyerValue,
      supplierCount: at.supplierCount,
      supplierValue: at.supplierValue,
      totalCount: at.buyerCount + at.supplierCount,
      totalValue: at.buyerValue + at.supplierValue,
      medianValue: median(at.values),
      computedAt,
    };
    if (at.lastSignedAt) stats.lastSignedAt = at.lastSignedAt;
    companyStats.push(stats);
  }

  const coverage: ContractCoverage = {
    total:
      registerTotal !== undefined && Number.isFinite(registerTotal)
        ? registerTotal
        : stored,
    stored,
    linked,
    bothLinked,
    companies: touched.size,
    namedPeople: namedPeople.size,
    withIndividual,
    registerInstitutions: buyerNips.size,
    from: from ?? "",
    to: to ?? "",
    computedAt,
    sources: ["cru"],
  };

  console.log(`Coverage: ${JSON.stringify(coverage)}`);
  for (const stats of companyStats.slice(0, 5)) {
    console.log(
      `  e.g. ${stats.nodeId}: ${stats.totalCount} contract(s), ` +
        `${Math.round(stats.totalValue)} PLN, median ${Math.round(stats.medianValue)}`,
    );
  }

  if (!commit) {
    console.log(
      `Dry run — ${companyStats.length} contractStats document(s) and ` +
        `stats/umowy not written.`,
    );
    return;
  }

  // Stale aggregates are deleted rather than left: a company whose last
  // contract was removed from the register would otherwise keep a section
  // asserting contracts that no query returns.
  const existing = await db.collection("contractStats").listDocuments();
  const stale = existing.filter((ref) => !perCompany.has(ref.id));
  for (let at = 0; at < stale.length; at += BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of stale.slice(at, at + BATCH_SIZE)) batch.delete(ref);
    await batch.commit();
  }
  if (stale.length) console.log(`Deleted ${stale.length} stale aggregate(s).`);

  for (let at = 0; at < companyStats.length; at += BATCH_SIZE) {
    const batch = db.batch();
    for (const stats of companyStats.slice(at, at + BATCH_SIZE)) {
      batch.set(db.collection("contractStats").doc(stats.nodeId), stats);
    }
    await batch.commit();
    console.log(
      `Wrote ${Math.min(at + BATCH_SIZE, companyStats.length)}/${companyStats.length}`,
    );
  }

  // Written last, so a run that dies halfway never advertises a `computedAt`
  // its per-company aggregates do not have.
  await db.collection("stats").doc("umowy").set(coverage);
  console.log("Wrote stats/umowy. Done.");
}

compute().catch((error) => {
  console.error(error);
  process.exit(1);
});
