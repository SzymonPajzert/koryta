import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type DocumentReference,
  type Firestore,
  type Timestamp,
  type WriteBatch,
} from "firebase-admin/firestore";
import type { Revision } from "../../shared/model";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "../../server/utils/revisions";
import { recordAudit } from "../../server/utils/audit";
import { edgeRevisionsForMany } from "../../server/utils/edgePublication";
import { reportRemaining } from "./remaining";

/**
 * Put back relations that were removed, by id.
 *
 * /api/edges/delete takes a relation off the graph as a soft delete: `deleted:
 * true` and `delete_reason` on the edge, an approved revision stating both,
 * an `audit` row. Nothing undid one. `applyRevision` keeps `deleted` when an
 * older revision is approved, on purpose - approving an ordinary edit must not
 * resurrect a removed relation - so re-approving the revision from before the
 * removal does not bring it back either. The undo button of the admin audit
 * log (admin-audit-log, 6d677cb2, unmerged since 08-29) would have; this is
 * its write, for a list of ids.
 *
 * The first list is restore-candidacies-removed-as-duplikat: 21 candidacies
 * removed as „duplikat” between 08-30 and 09-11 that PKW shows were a second
 * run of their own in that place and year, not a copy of the one left
 * standing (`restore_this_edge` in
 * ~/.cache/koryta/removed-duplicates-2026-10-12/removed-by-szymon-classified.csv).
 * Rehearsed on the emulator with the 2026-10-30T03:00 export: all 21 still
 * removed, between live pages and unpublished, so all 21 come back as drafts,
 * which each also was on the morning of its removal; 17 revisions wait for
 * review on 13 of them, the night's proposals among them. `--commit` wrote 21 revisions and 21 audit rows and changed nothing
 * else on the edges, and the dry run after it refused all 21 as not removed.
 *
 * For each id, in one batch with the others:
 *   - an approved revision of the relation as it stands, without `deleted`
 *     and `delete_reason`, by AUTHOR, and `revision_id` pointed at it. Left on
 *     the removal, re-approving that from /admin/rewizje would remove the
 *     relation again.
 *   - the edge itself as that revision says, plus what the document owns -
 *     and without either key, rather than with `deleted: false`, which
 *     `applyRevision` would carry over the next removal somebody approves.
 *   - `published` as it was. /api/edges/delete sets it false and what it was
 *     before is recorded nowhere, so a relation it removed comes back as a
 *     draft, for a reviewer to publish at /admin/krawedzie. The dry run says
 *     which come back live, should any removal have left one published.
 *   - an `audit` row, `restore`, naming that revision, with the reason given
 *     on the command line.
 *
 * It refuses, and lists, an id that names no relation, one that is not
 * removed, and one whose page at either end is missing, removed or merged
 * away: put back, that relation would hang off a page readers are sent away
 * from (test_a_live_edge_joins_two_live_pages).
 *
 * What it does not do:
 *   - publish anything, or answer a revision waiting on the relation. Those
 *     are a reviewer's, and the dry run counts them.
 *   - hook the relation back onto a fact it was promoted from. The removal
 *     took its id off the fact's `promotedEdgeIds`, and nothing kept which.
 *   - clear the Nitro handler cache, which only the endpoints can. A restored
 *     draft is not on the public site anyway.
 *
 * Each write fires `onEdgeWritten`, and the sweep then recomputes the
 * `stats.edges` of the relation's source page.
 *
 * A tool rather than a one-off: it finds no work of its own, the ids are the
 * whole question, so a dry run without them has nothing to report, and it
 * stays here rather than in archive/ once a list is put back (README, "Scripts
 * that are meant to be re-run"). Re-run with the same ids it refuses every one
 * as not removed and reports nothing left.
 *
 * Usage, from frontend/, against the running emulator:
 *   npx tsx scripts/migrate/restore-removed-edges.ts --reason "<why>" <edge id>...
 *   npx tsx scripts/migrate/restore-removed-edges.ts --reason "<why>" --ids-file <file>
 *   npx tsx scripts/migrate/restore-removed-edges.ts ... --commit
 * Against production:
 *   npx tsx scripts/migrate/restore-removed-edges.ts ... --prod
 *   npx tsx scripts/migrate/restore-removed-edges.ts ... --prod --commit
 * An ids file holds one id a line; blank lines and lines starting with # are
 * skipped.
 */

export const AUTHOR = "migration:restore-removed-edges";

/** Three writes a relation - its revision, the edge, the audit row - against
 * the 400 a batch the scripts here keep to. */
const RELATIONS_PER_BATCH = Math.floor(400 / 3);

const USAGE = `Usage, from frontend/:
  npx tsx scripts/migrate/restore-removed-edges.ts --reason "<why>" <edge id>... [--ids-file <file>] [--commit] [--prod]

  --reason    what the audit row of each restored relation says (required)
  --ids-file  a file of relation ids, one a line; # lines and blank lines are skipped
  --commit    write; without it, a dry run
  --prod      the production database; without it, the emulator on 127.0.0.1:8080`;

type Doc = Record<string, unknown>;

type RevisionDoc = Revision & { id: string };

/** A command line this script cannot act on. */
export class UsageError extends Error {}

export type Options = {
  isProd: boolean;
  commit: boolean;
  reason: string;
  /** In the order given, each once. */
  ids: string[];
  /** How many of the ids given were given again, and are asked about once. */
  repeated: number;
};

/** The ids in an ids file. A line holding anything beside its id - a CSV row,
 * a note - is kept whole, so that `parseArgs` refuses it rather than guess
 * which part of it was meant. */
export function parseIdList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** Whether a string can be a relation's id. Firestore refuses "/", "." and
 * "..", and ids shaped `__x__`; whitespace and commas are in no edge's id and
 * mean a line of something else. */
function canBeEdgeId(id: string): boolean {
  return (
    /^[^\s/,]+$/.test(id) && id !== "." && id !== ".." && !/^__.*__$/.test(id)
  );
}

export function parseArgs(
  argv: readonly string[],
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Options {
  let isProd = false;
  let commit = false;
  let reason: string | undefined;
  const given: string[] = [];
  // A flag's value cannot be another flag: `--reason --commit` is a reason
  // left out, not a reason that reads "--commit" on a dry run.
  const valueOf = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith("--")) {
      throw new UsageError(`${flag} needs a value`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--prod") {
      isProd = true;
    } else if (arg === "--commit") {
      commit = true;
    } else if (arg === "--reason") {
      reason = valueOf(arg, argv[++i]);
    } else if (arg === "--ids-file") {
      given.push(...parseIdList(readFile(valueOf(arg, argv[++i]))));
    } else if (arg.startsWith("--")) {
      throw new UsageError(`Unknown flag ${arg}`);
    } else {
      given.push(arg);
    }
  }

  if (!reason?.trim()) {
    throw new UsageError(
      "--reason is required: it is what the audit row of each restored relation says",
    );
  }
  const malformed = given.filter((id) => !canBeEdgeId(id));
  if (malformed.length > 0) {
    throw new UsageError(
      `Not relation ids: ${malformed.map((id) => JSON.stringify(id)).join(", ")}`,
    );
  }
  const ids = [...new Set(given)];
  if (ids.length === 0) {
    throw new UsageError("No relation ids given");
  }
  return {
    isProd,
    commit,
    reason: reason.trim(),
    ids,
    repeated: given.length - ids.length,
  };
}

/** What becomes of one id asked about. */
export type Verdict =
  | { id: string; restore: true; edge: Doc }
  | { id: string; restore: false; edge?: Doc; why: string };

type Restorable = Extract<Verdict, { restore: true }>;
type Refused = Extract<Verdict, { restore: false }>;

/** Why a relation cannot hang off this page, or nothing if it can: the page is
 * there, and neither removed nor merged into another. */
function deadEnd(
  id: unknown,
  nodes: ReadonlyMap<string, Doc>,
): string | undefined {
  const node = typeof id === "string" ? nodes.get(id) : undefined;
  if (!node) return `${String(id)} does not exist`;
  const into = node.merged_into;
  if (into) {
    const survivor =
      typeof into === "string" ? into : (into as { id?: unknown }).id;
    return `${String(id)} is merged into ${String(survivor ?? "another page")}`;
  }
  if (node.deleted === true) return `${String(id)} is removed`;
  return undefined;
}

/** Whether to put back the relation `id` names, given it as stored (or
 * nothing, if it is not) and the pages at its ends. */
export function judge(
  id: string,
  edge: Doc | undefined,
  nodes: ReadonlyMap<string, Doc>,
): Verdict {
  if (!edge) return { id, restore: false, why: "no such relation" };
  if (edge.deleted !== true) {
    const state = edge.published === true ? "live" : "a draft";
    return { id, restore: false, edge, why: `not removed (${state})` };
  }
  for (const end of ["source", "target"] as const) {
    const dead = deadEnd(edge[end], nodes);
    if (dead) return { id, restore: false, edge, why: `its ${end} ${dead}` };
  }
  return { id, restore: true, edge };
}

/** The removal being taken back: the newest revision of the relation, among
 * those not turned down, that states `deleted`. `revisions` newest first, as
 * `edgeRevisionsForMany` hands them over. */
export function removalOf(
  revisions: readonly RevisionDoc[],
): RevisionDoc | undefined {
  return revisions.find(
    (revision) =>
      revision.status !== "rejected" &&
      (revision.data as Doc | undefined)?.deleted === true,
  );
}

/** Writes one restore into `batch`: an approved revision of the relation as it
 * stands without its removal, the edge to match, and the audit row. Returns
 * the revision. */
export function writeRestore(
  db: Firestore,
  batch: WriteBatch,
  edgeRef: DocumentReference,
  edge: Doc,
  reason: string,
): DocumentReference {
  // `deleted` and `delete_reason` are fields the document owns, so
  // `createRevisionTransaction` layers what `stored` says of them back over
  // the revision. Withheld from it, the edge is written with neither key.
  const { deleted: _deleted, delete_reason: _reason, ...stored } = edge;
  const { revisionRef } = createRevisionTransaction(
    db,
    batch,
    { uid: AUTHOR },
    edgeRef,
    // `withoutInternalFields` drops `deleted`, `delete_reason` and
    // `published` with the rest, so the revision states the relation and
    // nothing about its removal.
    withoutInternalFields(edge),
    // No `published`: the stored value carries over.
    { stored, approve: true },
  );
  recordAudit(
    db,
    {
      action: "restore",
      collection: "edges",
      target_id: edgeRef.id,
      revision_id: revisionRef.id,
      user: AUTHOR,
      reason,
    },
    batch,
  );
  return revisionRef;
}

/** A Firestore Timestamp, told by its `toDate` rather than by `instanceof`:
 * under the Nuxt test environment firebase-admin's lazy exports read as
 * undefined. */
function isTimestamp(value: unknown): value is Timestamp {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  );
}

/** The year a relation began, as its start date says it. */
export function yearOf(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{4}/.test(value)) {
    return value.slice(0, 4);
  }
  if (isTimestamp(value)) return String(value.toDate().getUTCFullYear());
  return undefined;
}

function when(value: unknown): string {
  if (isTimestamp(value)) return value.toDate().toISOString();
  return value === undefined ? "?" : String(value);
}

async function readAll(
  db: Firestore,
  collection: string,
  ids: readonly string[],
): Promise<Map<string, Doc>> {
  const found = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids
      .slice(i, i + 100)
      .map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    for (const snap of await db.getAll(...refs)) {
      if (snap.exists) found.set(snap.id, snap.data()!);
    }
  }
  return found;
}

async function main() {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw error;
  }
  const { isProd, commit, reason, ids, repeated } = options;

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
      `${commit ? "writing" : "dry run - pass --commit to apply"}`,
  );
  console.info(
    `${ids.length} relation ids` +
      (repeated > 0 ? ` (${repeated} given twice, asked about once)` : "") +
      `; each audit row will say: ${JSON.stringify(reason)}`,
  );

  const edges = await readAll(db, "edges", ids);
  const ends = new Set<string>();
  for (const edge of edges.values()) {
    for (const end of [edge.source, edge.target]) {
      if (typeof end === "string" && end !== "") ends.add(end);
    }
  }
  const nodes = await readAll(db, "nodes", [...ends]);
  const verdicts = ids.map((id) => judge(id, edges.get(id), nodes));
  const restorable = verdicts.filter(
    (verdict): verdict is Restorable => verdict.restore,
  );
  const refused = verdicts.filter(
    (verdict): verdict is Refused => !verdict.restore,
  );
  const revisions = await edgeRevisionsForMany(
    db,
    restorable.map((verdict) => verdict.id),
  );

  const nameOf = (id: unknown) =>
    `${String(nodes.get(String(id))?.name ?? "?")} (${String(id)})`;
  const describe = (edge: Doc) => {
    const what = [
      edge.type,
      edge.position || edge.name,
      yearOf(edge.start_date) ?? "no date",
    ]
      .filter((part) => typeof part === "string" && part !== "")
      .join(" ");
    return `${what}: ${nameOf(edge.source)} -> ${nameOf(edge.target)}`;
  };

  console.info(
    `\n${commit ? "Restoring" : "Would restore"} (${restorable.length}):`,
  );
  for (const { id, edge } of restorable) {
    const history = revisions.get(id) ?? [];
    const removal = removalOf(history);
    const waiting = history.filter(
      (revision) => revision.status === "pending",
    ).length;
    console.info(`  ${id}  ${describe(edge)}`);
    console.info(
      `      removed ${removal ? `${when(removal.update_time)} by ${removal.update_user}` : "by no revision on record"}: ` +
        `${JSON.stringify(edge.delete_reason ?? null)}; ` +
        `comes back ${edge.published === true ? "LIVE" : "as a draft"}` +
        (waiting > 0
          ? `; ${waiting} revision${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""} for review on it`
          : ""),
    );
  }
  if (refused.length > 0) {
    console.info(`\nRefused (${refused.length}):`);
    for (const { id, why, edge } of refused) {
      console.info(`  ${id}  ${why}` + (edge ? `; ${describe(edge)}` : ""));
    }
  }

  const live = restorable.filter(({ edge }) => edge.published === true);
  console.info("");
  console.info(`  to restore:          ${restorable.length}`);
  console.info(`    back as drafts:    ${restorable.length - live.length}`);
  console.info(`    back live:         ${live.length}`);
  console.info(`  refused:             ${refused.length}`);

  if (!commit) {
    reportRemaining({ restore: restorable.length });
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  for (let i = 0; i < restorable.length; i += RELATIONS_PER_BATCH) {
    const batch = db.batch();
    for (const { id, edge } of restorable.slice(i, i + RELATIONS_PER_BATCH)) {
      writeRestore(db, batch, db.collection("edges").doc(id), edge, reason);
    }
    await batch.commit();
  }

  console.info(
    `\nRestored ${restorable.length} relations, each with an approved ` +
      `revision and a \`restore\` audit row by ${AUTHOR}.`,
  );
  console.info(
    "Re-run the dry run: it must refuse every one as not removed and report " +
      "nothing left to restore.",
  );
}

// Importable by the tests, which check the decisions and the write without
// Firestore. Same guard as `fix-stale-seats.ts`.
if (process.argv[1]?.endsWith("restore-removed-edges.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
