import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import { CONTENT_CHANGED_AT } from "../../shared/lastmod";
import { reportRemaining } from "./remaining";

/**
 * Gives every page still dated 2026-10-24T14:08:20Z the date it last changed.
 *
 * What was wrong. On 2026-10-24 at about 21:33 UTC the first entry of
 * `stamp-site-changes.ts`, canonical-and-snippets-2026-10-24, raised
 * `content_changed_at` to 14:08:20.000Z on every page in the sitemap: 9,197 of
 * the 9,223 urls then carried that one instant. Both halves of the entry were
 * off (~/.cache/koryta/lastmod-accuracy-2026-10-24/REPORT.md):
 *
 * - the instant: 14:08:20 is the DONE of rollout-2026-10-24-001 (11d4087),
 *   which changed no entity page - 0 of 749 rendered pages differ from the
 *   build before. The descriptions and snippets the entry names went live with
 *   rollout-002 (f45a6ad), DONE 15:20:13.6Z;
 * - the scope: every sitemap page, where the descriptions changed on about 44%
 *   of them (persons 85%, companies 34%, articles none).
 *
 * The same date on most urls is what Google and Bing describe as a sitemap
 * generator not worth believing. On 2026-11-09 the live sitemap still had 4,780
 * of its 13,891 urls at exactly 14:08:20, and Googlebot's recrawls showed no use
 * of `<lastmod>`: around its 11-06 sitemap read it fetched 5.6% of the companies
 * whose date had moved against 6.7% of those whose date had not
 * (~/.cache/koryta/gsc-2026-11-09/).
 *
 * The correction, option (a) of decide-how-to-correct-the-10-24-lastmod-stamp,
 * which Szymon approved on 2026-11-09: each page still at the stamp goes to the
 * newest of what really changed on it -
 *
 * - `own`: its own `content_changed_at` before the stamp, from the export
 *   taken at 14:12 that day (where it had none, `revised`: its
 *   `revisions.latest_time`, the other date `sitemapLastmod` reads);
 * - `snippets-1024`: 15:20:13.6Z, where its meta description changed with
 *   rollout-002;
 * - `board-1024`: 21:46:02Z, where its „Obecny skład” began listing
 *   unpublished holders with rollout-003 (`company-boards-unpublished-holders`);
 * - `links-0918`: 2026-09-18T21:30:38Z, where it listed a relation when
 *   rollout-2026-09-18-000 moved every relation link from /entity/... to the
 *   page's canonical url (a links change Google counts as significant);
 * - `site-1007`: 2026-10-07T12:07:38Z, where rollout-2026-10-07-000 changed
 *   its rows - a sector chip that stopped being a link of its own, a
 *   candidacy that gained its office - or dropped „Inne” from its description;
 * - `days-1020`: 2026-10-20T06:19:43Z, for the 507 person pages whose
 *   candidacy days rollout-2026-10-20-000 recomputed.
 *
 * So it lowers some pages and raises others. On the 2026-11-09 export, of the
 * 4,867 nodes at the stamp it lowers 2,341 (all 817 articles, 129 persons,
 * 1,395 companies) and raises 2,526 by hours, to the description change at
 * 15:20 (530 persons, 876 companies) or the board change at 21:46 (1,120
 * companies). Each ends on a date a crawler could check against the page.
 *
 * Where `own` is itself too early - the backfill behind it dated a relation by
 * its last revision, not by when it was published - this keeps it: too early
 * costs a recrawl, never the trust a too-late date costs. The audit log shows
 * two such pages, both articles whose mention list grew weeks later.
 *
 * Why a plan file rather than computing it here. None of those inputs can be
 * read off production any more: the stamp overwrote the date each page had
 * before it, whether a description changed takes the `entitySeo` of two old
 * builds run over that day's data, and which pages listed a relation, a board
 * or a chip is the state of days long gone. They are measured offline from the
 * exports of those days by `correct-10-24-stamp/build-plan.ts` (which says how
 * to rerun it), into `correct-10-24-stamp/plan.csv` - one line per page, the
 * date and which input won - and this only applies that file.
 *
 * Guards:
 *
 * - it touches a node only while its `content_changed_at` is exactly
 *   "2026-10-24T14:08:20.000Z", the string the stamp stored. That is re-read
 *   inside the transaction that writes it, so a page the edge trigger or a
 *   publication re-dated meanwhile keeps its newer date;
 * - a node at the stamp with no line in the plan is listed and left alone;
 * - so it is idempotent: a corrected page no longer carries the stamp, and a
 *   second run finds nothing.
 *
 * The cause is fixed alongside: `SITE_CHANGES` in `stamp-site-changes.ts`
 * marks the entry superseded, so a full rerun of that script skips it rather
 * than raising these pages back to 14:08:20. Never run `stamp-site-changes.ts`
 * from a checkout older than that commit once this has run: there the entry is
 * live and would put 2,341 corrected pages back on the stamp.
 *
 * Archiving: move `correct-10-24-stamp/` together with this file, or the
 * archived dry run fails on the missing plan; then fix the relative imports in
 * both, `build-plan.ts`'s `../stamp-site-changes` included.
 *
 * After a production run the sitemap still answers from cache for up to ~7 h
 * (the handler's 6 h cache with swr, the CDN's 600 s + 1 h swr, up to 10
 * instances) unless a redeploy clears it.
 *
 * Usage (against the running emulators:prod-data emulator):
 *   npx tsx scripts/migrate/correct-10-24-stamp.ts                  # dry run
 *   npx tsx scripts/migrate/correct-10-24-stamp.ts --commit         # apply
 * Against production:
 *   npx tsx scripts/migrate/correct-10-24-stamp.ts --prod           # dry run
 *   npx tsx scripts/migrate/correct-10-24-stamp.ts --prod --commit
 * On a Mac where gRPC fails over IPv6 (EHOSTUNREACH), prefix both with
 * `FIRESTORE_PREFER_REST=true NODE_OPTIONS=--dns-result-order=ipv4first`; the
 * transaction and getAll go over REST too.
 * `--plan <file>` reads another plan than the one beside it.
 */

/** The value canonical-and-snippets-2026-10-24 wrote, exactly as it stored
 * it: `new Date("2026-10-24T14:08:20Z").toISOString()`. Every node at the
 * stamp in the 2026-11-09 export holds this string and no other form. */
export const STAMP = "2026-10-24T14:08:20.000Z";

/** Whether a stored `content_changed_at` is the stamp. Only the exact string:
 * any other value - a later date, an earlier one, the same instant spelled
 * another way - was written by something else and is not this script's. */
export function isStamp(value: unknown): boolean {
  return value === STAMP;
}

/** What decided a page's date, in the order a tie between two equal instants
 * is settled. */
export const REASONS = [
  "own",
  "revised",
  "links-0918",
  "site-1007",
  "days-1020",
  "snippets-1024",
  "board-1024",
] as const;
export type Reason = (typeof REASONS)[number];

/** When each change to the whole site went live: the DONE of the prod build
 * that carried it (`stamp-site-changes.ts` says how to find one), to the
 * second - 002 to the tenth, as the approved decision quotes it. */
export const SITE_INSTANTS = {
  // rollout-2026-09-18-000 (5f985ed1). Its build log is past Cloud Logging's
  // 30 days, so this is the creation of the Cloud Run revision it made,
  // prod-build-2026-09-18-000, at 21:30:38.447Z (`gcloud run revisions list
  // --service prod --region europe-west4`). On the six rollouts that still
  // have both, the revision follows the DONE by 11-16 s: this is that much
  // after the instant the other entries use, never before it.
  "links-0918": "2026-09-18T21:30:38.000Z",
  // rollout-2026-10-07-000, build 78f82df6 (7889489), DONE 12:07:38.732Z.
  "site-1007": "2026-10-07T12:07:38.000Z",
  // rollout-2026-10-20-000, build 75cbfbbc (30e7f90), DONE 06:19:43.536Z.
  "days-1020": "2026-10-20T06:19:43.000Z",
  // rollout-2026-10-24-002, build 1850982c (f45a6ad), DONE 15:20:13.629Z.
  "snippets-1024": "2026-10-24T15:20:13.600Z",
  // rollout-2026-10-24-003, build a72f5751 (3cab5cf), DONE 21:46:02.862Z -
  // the instant SITE_CHANGES dates company-boards-unpublished-holders to.
  "board-1024": "2026-10-24T21:46:02.000Z",
} as const satisfies Partial<Record<Reason, string>>;

/** One input to a page's date: an instant, or nothing where it does not
 * apply. */
export type Candidate = { reason: Reason; at: string | null | undefined };

/** The page's date: the newest instant among `candidates`, with the reason it
 * came from. Nothing when none of them applies. Instants are compared as
 * instants, and returned as `toISOString` writes them. */
export function honestDate(
  candidates: readonly Candidate[],
): { target: string; reason: Reason } | undefined {
  let best: { ms: number; reason: Reason } | undefined;
  for (const reason of REASONS) {
    for (const candidate of candidates) {
      if (candidate.reason !== reason || !candidate.at) continue;
      const ms = Date.parse(candidate.at);
      if (Number.isNaN(ms)) {
        throw new Error(`${reason}: "${candidate.at}" is not an instant`);
      }
      if (!best || ms > best.ms) best = { ms, reason };
    }
  }
  return (
    best && {
      target: new Date(best.ms).toISOString(),
      reason: best.reason,
    }
  );
}

/** One line of the plan. */
export type PlanRow = { id: string; target: string; reason: Reason };

const HEADER = "id,target,reason";

export function formatPlan(rows: readonly PlanRow[]): string {
  const lines = [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => `${row.id},${row.target},${row.reason}`);
  return [HEADER, ...lines].join("\n") + "\n";
}

/** The plan, keyed by node id. Strict: a malformed line is an error rather
 * than a page silently left out, because the file is the whole record of what
 * each page is set to. */
export function parsePlan(text: string): Map<string, PlanRow> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines[0] !== HEADER) {
    throw new Error(`The plan has to start with "${HEADER}"`);
  }
  const plan = new Map<string, PlanRow>();
  for (const [index, line] of lines.slice(1).entries()) {
    const where = `plan line ${index + 2}`;
    const [id, target, reason, ...rest] = line.split(",");
    if (!id || !target || !reason || rest.length > 0) {
      throw new Error(`${where}: "${line}" is not id,target,reason`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`${where}: "${id}" is not a node id`);
    }
    const ms = Date.parse(target);
    if (Number.isNaN(ms) || new Date(ms).toISOString() !== target) {
      throw new Error(`${where}: "${target}" is not an ISO instant`);
    }
    if (!(REASONS as readonly string[]).includes(reason)) {
      throw new Error(`${where}: "${reason}" is not one of ${REASONS}`);
    }
    if (plan.has(id)) throw new Error(`${where}: ${id} is planned twice`);
    plan.set(id, { id, target, reason: reason as Reason });
  }
  return plan;
}

/** Which way a page's date moves from the stamp. */
export type Direction = "lower" | "raise" | "same";

export function direction(target: string): Direction {
  return target < STAMP ? "lower" : target > STAMP ? "raise" : "same";
}

/** A node, as much of it as this reads. */
export type NodeRow = { type?: unknown; [CONTENT_CHANGED_AT]?: unknown };

export type Correction = PlanRow & { type: string; direction: Direction };

/** What applying `plan` to `nodes` would write.
 *
 * `write`: the nodes at the stamp whose plan line moves them. `same`: at the
 * stamp, planned to stay there - nothing to write. `unplanned`: at the stamp
 * with no plan line, left alone and listed. A node at any other value is not
 * looked at, planned or not. */
export function corrections(
  nodes: Iterable<[string, NodeRow]>,
  plan: ReadonlyMap<string, PlanRow>,
): { write: Correction[]; same: Correction[]; unplanned: string[] } {
  const write: Correction[] = [];
  const same: Correction[] = [];
  const unplanned: string[] = [];
  for (const [id, node] of nodes) {
    if (!isStamp(node[CONTENT_CHANGED_AT])) continue;
    const row = plan.get(id);
    if (!row) {
      unplanned.push(id);
      continue;
    }
    const correction: Correction = {
      ...row,
      type: typeof node.type === "string" ? node.type : "?",
      direction: direction(row.target),
    };
    (correction.direction === "same" ? same : write).push(correction);
  }
  return { write, same, unplanned };
}

/** The dry run's table: how many pages move which way, why, by type. */
export function tally(rows: readonly Correction[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.type} ${row.direction} ${row.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, count]) => {
      const [type, way, reason] = key.split(" ");
      return `  ${type!.padEnd(8)} ${way!.padEnd(6)} ${reason!.padEnd(14)} ${count}`;
    });
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLAN = join(HERE, "correct-10-24-stamp", "plan.csv");

/** Writes `chunk`, each node only if it still holds the stamp when the
 * transaction reads it. Returns how many it wrote. */
async function writeChunk(
  db: Firestore,
  chunk: readonly Correction[],
): Promise<number> {
  return db.runTransaction(async (tx) => {
    const refs: DocumentReference[] = chunk.map((row) =>
      db.collection("nodes").doc(row.id),
    );
    const snaps = await tx.getAll(...refs, { fieldMask: [CONTENT_CHANGED_AT] });
    let written = 0;
    snaps.forEach((snap, i) => {
      if (!snap.exists || !isStamp(snap.get(CONTENT_CHANGED_AT))) return;
      tx.update(refs[i]!, { [CONTENT_CHANGED_AT]: chunk[i]!.target });
      written++;
    });
    return written;
  });
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const planFlag = process.argv.indexOf("--plan");
  const planPath = planFlag >= 0 ? process.argv[planFlag + 1] : PLAN;
  if (!planPath) throw new Error("--plan needs a file");

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }
  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  const plan = parsePlan(readFileSync(planPath, "utf8"));
  console.log(`Plan: ${plan.size} page(s) in ${planPath}.`);

  // Only the nodes at the stamp: an equality on the field, so the run reads
  // those few thousand documents rather than every node.
  const snap = await db
    .collection("nodes")
    .where(CONTENT_CHANGED_AT, "==", STAMP)
    .select("type", CONTENT_CHANGED_AT)
    .get();
  const { write, same, unplanned } = corrections(
    snap.docs.map((doc) => [doc.id, doc.data() as NodeRow]),
    plan,
  );
  console.log(
    `${snap.size} node(s) at ${STAMP}; ${plan.size - snap.size + unplanned.length} ` +
      "planned page(s) no longer are and are left as they are.",
  );
  if (unplanned.length > 0) {
    console.log(
      `${unplanned.length} at the stamp with no line in the plan, left alone: ` +
        unplanned.slice(0, 20).join(", ") +
        (unplanned.length > 20 ? ", ..." : ""),
    );
  }
  if (same.length > 0) {
    console.log(`${same.length} planned to stay at the stamp.`);
  }

  console.log(
    `\n${commit ? "Writing" : "Would write"} ${write.length} ` +
      "(type, direction, reason, count):",
  );
  for (const line of tally(write)) console.log(line);

  if (!commit) {
    reportRemaining({
      lower: write.filter((row) => row.direction === "lower").length,
      raise: write.filter((row) => row.direction === "raise").length,
    });
    return;
  }

  let written = 0;
  for (let i = 0; i < write.length; i += 400) {
    written += await writeChunk(db, write.slice(i, i + 400));
  }
  console.log(
    `\nWrote ${written}; ${write.length - written} had moved off the stamp ` +
      "since they were read and were left as they are.",
  );
}

// Importable by the tests and by build-plan.ts, which use the functions above
// without touching Firestore. Same guard as `stamp-site-changes.ts`.
if (process.argv[1]?.endsWith("correct-10-24-stamp.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
