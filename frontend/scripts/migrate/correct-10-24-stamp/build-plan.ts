import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_CHANGED_AT, inSitemap } from "../../../shared/lastmod";
import { asArray, pageIsPublic } from "../../../shared/model";
import { OTHER_PARTY } from "../../../shared/misc";
import {
  REASONS,
  SITE_INSTANTS,
  direction,
  formatPlan,
  honestDate,
  isStamp,
  type Candidate,
  type PlanRow,
  type Reason,
} from "../correct-10-24-stamp";
import {
  boardCandidates,
  boardCompanies,
  type EdgeRow,
  type NodeRow,
} from "../stamp-site-changes";

/**
 * Builds `plan.csv`, the date `correct-10-24-stamp.ts` gives each page still at
 * the 10-24 stamp, from the exports of the days that decide it. Offline: it
 * reads files and writes one, and never connects to Firestore.
 *
 * For each node whose `content_changed_at` is the stamp in the newest export,
 * the newest of (`honestDate`):
 *
 * - `own`: its `content_changed_at` in the export of 2026-10-24T14:12:36Z, the
 *   last one before the stamp ran (~21:33Z); `revised` where it had none;
 * - `snippets-1024`: its meta description changed between 11d4087 and
 *   f45a6ad, as `measure.mts` of the lastmod-accuracy workflow measured it on
 *   that same 14:12 export (`--desc`, its `pages-1412.jsonl`);
 * - `board-1024`: a company `boardCompanies` puts in scope on the 14:12
 *   export, the 10-25 03:00 export or the newest one. Either side of
 *   rollout-003 (21:46:02Z): a company still at the stamp whose board changed
 *   after the edge trigger went live (~21:36Z) would have been re-dated by it,
 *   so in scope at either end means in scope at 21:46. The newest export is in
 *   the union so that `stamp-site-changes.ts` finds nothing left to raise once
 *   this is applied;
 * - `links-0918`: a live person or company page with at least one relation a
 *   logged-out reader saw - a published edge to another live person, company
 *   or region - in both the 09-18 and 09-19 02:00 exports. Rollout 09-18 moved
 *   the href of every such row (EmploymentHistory, ConnectionList, ShortNode)
 *   from /entity/<type>/<id> to the page's canonical url. Article pages render
 *   none of those components;
 * - `site-1007`: in both the 10-07 and 10-08 02:00 exports, a live person or
 *   company page with a row naming a live company that has sectors (the chip
 *   stopped being a link of its own, 7889489d), a person page with a candidacy
 *   that has an office (`position`, now printed on the row), or a person whose
 *   parties include „Inne” (dropped from the meta description);
 * - `days-1020`: the 507 person pages whose candidacy days changed with
 *   rollout 10-20 (`--days`, `days-changed-pages-2026-10-20.tsv` of the same
 *   workflow, measured on the 10-20 02:00 export).
 *
 * Not floored, so at worst a page is dated earlier than a change it did get
 * (which costs a recrawl, never trust): rollout 10-07's roleless-spell and
 * owner de-duplication, 09-25's „Wybrany” chip and 10-10's Wikipedia link,
 * none of which has been measured per page.
 *
 * Rerun, from the repository root (about 10 minutes, ~700 MB of exports and
 * dumps; reading the bucket is all it does with production):
 *
 *   D=~/.cache/koryta/correct-10-24-stamp
 *   PY="data/pipelines/.venv/bin/python -I"
 *   DUMP=frontend/scripts/migrate/correct-10-24-stamp/dump_export.py
 *   B=gs://koryta-pl-crawled/hostname=koryta.pl
 *   get() { mkdir -p $D/exports/$1/all_namespaces/kind_$2 &&
 *     gsutil -m cp "$B/$1/all_namespaces/kind_$2/*" $D/exports/$1/all_namespaces/kind_$2/; }
 *   for E in date=2026-09-18T02:00:39.197Z date=2026-09-19T02:00:30.060Z \
 *            date=2026-10-07T02:00:36.396Z date=2026-10-08T02:00:57.961Z; do
 *     get $E nodes; get $E edges
 *   done
 *   for K in nodes edges revisions; do get date=2026-10-24T14:12:36.085Z $K; done
 *   for K in nodes edges revisions; do get date=2026-10-25T03:00:33.098Z $K; done
 *   $PY $DUMP $D/exports/date=2026-09-18T02:00:39.197Z $D/0918 nodes edges
 *   $PY $DUMP $D/exports/date=2026-09-19T02:00:30.060Z $D/0919 nodes edges
 *   $PY $DUMP $D/exports/date=2026-10-07T02:00:36.396Z $D/1007 nodes edges
 *   $PY $DUMP $D/exports/date=2026-10-08T02:00:57.961Z $D/1008 nodes edges
 *   $PY $DUMP $D/exports/date=2026-10-24T14:12:36.085Z $D/1412
 *   $PY $DUMP $D/exports/date=2026-10-25T03:00:33.098Z $D/1025
 *   $PY $DUMP <newest export, e.g. ~/.cache/koryta/firestore-export/date=...> $D/latest
 *   cd frontend && npx tsx scripts/migrate/correct-10-24-stamp/build-plan.ts
 *
 * (`--dumps <dir>` for another D, `--desc <pages-1412.jsonl>`, `--days <tsv>`,
 * `--out <plan.csv>`.) The two measured inputs are in
 * ~/.cache/koryta/lastmod-accuracy-2026-10-24/: `--desc` is
 * verify-site-changes-F2-scope-sitemap-pages-too-wide-scale/pages-1412.jsonl
 * (rerun: `measure.mts 1412` in that directory), `--days` is
 * verify-site-changes-F4-history-site-change-frequency-scale/days-changed-pages-2026-10-20.tsv
 * (rerun: `days.mts` there). Rebuilt on a newer `latest`, the plan can only
 * shrink: nothing writes the stamp any more.
 */

type Dump = {
  nodes: Map<string, NodeDoc>;
  edges: EdgeDoc[];
  /** The first revision of each document, by `update_time`, where read. */
  firstRevision?: Map<string, { update_automatic?: unknown }>;
};

type NodeDoc = NodeRow & {
  categories?: unknown;
  parties?: unknown;
  revisions?: { latest_time?: unknown; has_unapproved?: unknown } | null;
};

type EdgeDoc = EdgeRow & {
  id: string;
  type?: unknown;
  position?: unknown;
  published?: unknown;
};

function jsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export function loadDump(dir: string, withRevisions = false): Dump {
  const nodes = new Map<string, NodeDoc>();
  for (const row of jsonl<NodeDoc & { id: string }>(join(dir, "nodes.jsonl"))) {
    nodes.set(row.id, row);
  }
  const edges = jsonl<EdgeDoc>(join(dir, "edges.jsonl"));
  if (!withRevisions) return { nodes, edges };

  const first = new Map<
    string,
    { update_time: string; update_automatic?: unknown }
  >();
  for (const rev of jsonl<{
    node_id?: unknown;
    update_time?: unknown;
    update_automatic?: unknown;
  }>(join(dir, "revisions.jsonl"))) {
    if (
      typeof rev.node_id !== "string" ||
      typeof rev.update_time !== "string"
    ) {
      continue;
    }
    const seen = first.get(rev.node_id);
    if (!seen || rev.update_time < seen.update_time) {
      first.set(rev.node_id, {
        update_time: rev.update_time,
        update_automatic: rev.update_automatic,
      });
    }
  }
  return { nodes, edges, firstRevision: first };
}

/** `boardCompanies` on one export, with `importedOrReviewed` answered from the
 * dump: an approved revision, or a first revision an import wrote. */
export function boardScope(dump: Dump): Set<string> {
  const employed = new Map<string, EdgeRow>(
    dump.edges.filter((e) => e.type === "employed").map((e) => [e.id, e]),
  );
  const candidates = boardCandidates(dump.nodes, employed);
  const shown = new Set<string>();
  const check = (id: string, revisionId: unknown) => {
    if (revisionId) shown.add(id);
    else if (dump.firstRevision?.get(id)?.update_automatic === true) {
      shown.add(id);
    }
  };
  for (const c of candidates) {
    check(c.person, dump.nodes.get(c.person)?.revision_id);
    check(c.edge, employed.get(c.edge)?.revision_id);
  }
  return boardCompanies(candidates, shown);
}

const RELATED = new Set(["person", "place", "region"]);

/** The person and company pages and the far ends of the relations a
 * logged-out reader sees on them: a published edge between two live nodes,
 * each a person, a company or a region (what `/api/graph/local` keeps). */
function visibleRelations(dump: Dump) {
  const rows: { page: string; far: NodeDoc; edge: EdgeDoc }[] = [];
  for (const edge of dump.edges) {
    if (!pageIsPublic(edge)) continue;
    if (typeof edge.source !== "string" || typeof edge.target !== "string") {
      continue;
    }
    const source = dump.nodes.get(edge.source);
    const target = dump.nodes.get(edge.target);
    if (!source || !target || !pageIsPublic(source) || !pageIsPublic(target)) {
      continue;
    }
    if (
      !RELATED.has(source.type as string) ||
      !RELATED.has(target.type as string)
    ) {
      continue;
    }
    for (const [page, far] of [
      [edge.source, target],
      [edge.target, source],
    ] as const) {
      const node = dump.nodes.get(page)!;
      if (inSitemap(node) && node.type !== "article") {
        rows.push({ page, far, edge });
      }
    }
  }
  return rows;
}

/** Pages that listed at least one relation (`links-0918`). */
export function pagesWithRelations(dump: Dump): Set<string> {
  return new Set(visibleRelations(dump).map((row) => row.page));
}

/** Pages rollout 10-07 changed (`site-1007`). */
export function pagesChangedOn1007(dump: Dump): Set<string> {
  const pages = new Set<string>();
  for (const { page, far, edge } of visibleRelations(dump)) {
    if (far.type === "place" && asArray(far.categories as never).length > 0) {
      pages.add(page);
    }
    if (
      edge.type === "election" &&
      typeof edge.position === "string" &&
      edge.position.trim() !== "" &&
      dump.nodes.get(page)?.type === "person"
    ) {
      pages.add(page);
    }
  }
  for (const [id, node] of dump.nodes) {
    const parties = asArray<string>(node.parties as never);
    if (
      node.type === "person" &&
      inSitemap(node) &&
      parties.includes(OTHER_PARTY)
    ) {
      pages.add(id);
    }
  }
  return pages;
}

function both(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a].filter((id) => b.has(id)));
}

/** One page's plan line: the newest of what reached it. Nothing where the
 * 14:12 export does not have the page, or where nothing dates it. */
export function planFor(
  id: string,
  before: NodeDoc | undefined,
  scopes: {
    desc: ReadonlySet<string>;
    board: ReadonlySet<string>;
    links0918: ReadonlySet<string>;
    site1007: ReadonlySet<string>;
    days1020: ReadonlySet<string>;
  },
): PlanRow | undefined {
  if (!before) return undefined;
  const own = before[CONTENT_CHANGED_AT];
  const ownAt = typeof own === "string" && !isStamp(own) ? own : undefined;
  const latest = before.revisions?.latest_time;
  const candidates: Candidate[] = [
    { reason: "own", at: ownAt },
    {
      reason: "revised",
      at:
        !ownAt &&
        before.revisions?.has_unapproved !== true &&
        typeof latest === "string"
          ? latest
          : undefined,
    },
    {
      reason: "links-0918",
      at: scopes.links0918.has(id) ? SITE_INSTANTS["links-0918"] : undefined,
    },
    {
      reason: "site-1007",
      at: scopes.site1007.has(id) ? SITE_INSTANTS["site-1007"] : undefined,
    },
    {
      reason: "days-1020",
      at: scopes.days1020.has(id) ? SITE_INSTANTS["days-1020"] : undefined,
    },
    {
      reason: "snippets-1024",
      at: scopes.desc.has(id) ? SITE_INSTANTS["snippets-1024"] : undefined,
    },
    {
      reason: "board-1024",
      at: scopes.board.has(id) ? SITE_INSTANTS["board-1024"] : undefined,
    },
  ];
  const date = honestDate(candidates);
  return date && { id, ...date };
}

function argument(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const cache = join(homedir(), ".cache/koryta");
  const workflow = join(cache, "lastmod-accuracy-2026-10-24");
  const dumps = argument("--dumps", join(cache, "correct-10-24-stamp"));
  const descPath = argument(
    "--desc",
    join(
      workflow,
      "verify-site-changes-F2-scope-sitemap-pages-too-wide-scale/pages-1412.jsonl",
    ),
  );
  const daysPath = argument(
    "--days",
    join(
      workflow,
      "verify-site-changes-F4-history-site-change-frequency-scale/days-changed-pages-2026-10-20.tsv",
    ),
  );
  const out = argument("--out", join(here, "plan.csv"));
  for (const path of [dumps, descPath, daysPath]) {
    if (!existsSync(path)) {
      throw new Error(`${path} is missing; see the docstring`);
    }
  }

  const at1412 = loadDump(join(dumps, "1412"), true);
  const latest = loadDump(join(dumps, "latest"), true);

  const desc = new Set(
    jsonl<{ id: string; descChanged?: unknown }>(descPath)
      .filter((row) => row.descChanged === true)
      .map((row) => row.id),
  );
  const days1020 = new Set(
    readFileSync(daysPath, "utf8")
      .split("\n")
      .map((line) => line.split("\t")[0]!)
      .filter((id) => id.length > 0),
  );
  const boards = {
    "10-24 14:12": boardScope(at1412),
    "10-25 03:00": boardScope(loadDump(join(dumps, "1025"), true)),
    latest: boardScope(latest),
  };
  const board = new Set(Object.values(boards).flatMap((set) => [...set]));
  const links0918 = both(
    pagesWithRelations(loadDump(join(dumps, "0918"))),
    pagesWithRelations(loadDump(join(dumps, "0919"))),
  );
  const site1007 = both(
    pagesChangedOn1007(loadDump(join(dumps, "1007"))),
    pagesChangedOn1007(loadDump(join(dumps, "1008"))),
  );
  console.log(
    `scopes: description ${desc.size}, 10-20 days ${days1020.size}, ` +
      `09-18 links ${links0918.size}, 10-07 rows ${site1007.size}, boards ` +
      Object.entries(boards)
        .map(([tag, set]) => `${tag} ${set.size}`)
        .join(", ") +
      ` (union ${board.size})`,
  );

  const rows: PlanRow[] = [];
  const unplanned: string[] = [];
  const tallies = new Map<string, number>();
  for (const [id, node] of latest.nodes) {
    if (!isStamp(node[CONTENT_CHANGED_AT])) continue;
    const row = planFor(id, at1412.nodes.get(id), {
      desc,
      board,
      links0918,
      site1007,
      days1020,
    });
    if (!row) {
      unplanned.push(id);
      continue;
    }
    rows.push(row);
    const key = `${String(node.type).padEnd(8)} ${direction(row.target).padEnd(6)} ${row.reason}`;
    tallies.set(key, (tallies.get(key) ?? 0) + 1);
  }

  writeFileSync(out, formatPlan(rows));
  console.log(`\n${rows.length} page(s) planned into ${out}`);
  for (const [key, count] of [...tallies].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    console.log(`  ${key.padEnd(32)} ${count}`);
  }
  if (unplanned.length > 0) {
    console.log(
      `${unplanned.length} at the stamp with nothing to date them by, left out: ` +
        unplanned.slice(0, 20).join(", "),
    );
  }
  const byReason = (reason: Reason) =>
    rows.filter((row) => row.reason === reason).length;
  console.log(
    `reasons: ${REASONS.map((reason) => `${reason} ${byReason(reason)}`).join(", ")}`,
  );
}

if (process.argv[1]?.endsWith("build-plan.ts")) main();
