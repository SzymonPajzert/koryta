import { initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { CONTENT_CHANGED_AT, inSitemap } from "../../shared/lastmod";
import { pageIsPublic } from "../../shared/model";
import { importedOrReviewed } from "../../server/utils/provenance";
import { reportRemaining } from "./remaining";

/**
 * Dates the pages a change to the whole site reached, at the instant the change
 * went live.
 *
 * A page's `<lastmod>` is the newest instant something recorded about that page
 * (shared/lastmod.ts): its own revisions, and `content_changed_at`, which the
 * write paths stamp when the page or a relation on it changes. A deploy writes
 * nothing, so a change to how every page is drawn reached thousands of pages
 * without moving one date. Google is then told those pages have not changed
 * since before the change - the canonical url Search Console still holds a
 * lowercased copy of, or the empty board a company page used to show - and
 * comes back at its own pace, weeks to months for a person page.
 *
 * So each such change is written down here, with the instant it went live and
 * the pages it reached, and this raises `content_changed_at` on those pages to
 * that instant. Never lowers it: a later stamp is a later change. Szymon,
 * 2026-10-24: "a system to include the changes to lastmod - fixes to canonical
 * urls and for the companies with added people who are not published".
 *
 * The instant is the `DONE` of the prod build that carried the change, which
 * is when the rollout went live, to within a minute:
 *
 *   gcloud logging read 'protoPayload.serviceName="firebaseapphosting.googleapis.com"
 *     AND protoPayload.methodName:"CreateRollout"' --freshness=7d   # the rollout
 *   gcloud logging read 'resource.type="build" AND (textPayload="DONE"
 *     OR textPayload:"HEAD is now at")' --freshness=7d             # its build
 *
 * A change that has not gone live yet has no instant and is skipped: a date
 * earlier than the change would tell a crawler that came between the two that
 * nothing has changed since.
 *
 * Meant to be run again: add a change to `SITE_CHANGES` once it is live, then
 * dry-run and apply as below. A clean run writes nothing.
 *
 * Usage (against the running emulators:prod-data emulator):
 *   npx tsx scripts/migrate/stamp-site-changes.ts                  # dry run, every dated change
 *   npx tsx scripts/migrate/stamp-site-changes.ts --change <id>    # one of them
 *   npx tsx scripts/migrate/stamp-site-changes.ts --commit         # apply
 * Against production:
 *   npx tsx scripts/migrate/stamp-site-changes.ts --prod           # dry run
 *   npx tsx scripts/migrate/stamp-site-changes.ts --prod --commit
 */

/** Which pages a change reached. */
export type SiteChangeScope =
  /** Every page in the sitemap (`inSitemap`). */
  | "sitemap-pages"
  /** The live companies whose „Obecny skład” lists an unpublished holder
   * (`boardCompanies`). */
  | "boards-with-unpublished-holders";

export type SiteChange = {
  id: string;
  /** When it went live, ISO 8601 UTC; null until it has. */
  at: string | null;
  /** What changed on the pages, for whoever reads this list next. */
  what: string;
  scope: SiteChangeScope;
};

export const SITE_CHANGES: readonly SiteChange[] = [
  {
    id: "canonical-and-snippets-2026-10-24",
    // rollout-2026-10-24-001, build 76c88044 (11d4087), DONE 14:08:20 UTC.
    at: "2026-10-24T14:08:20Z",
    what:
      "seo-old-urls, sitemap-lastmod and search-snippets: old urls answer " +
      "301, and every entity page's description and snippet text were " +
      "rewritten. Search Console still held pages from before the 08-08 " +
      "canonical fix with nothing telling Google to look again.",
    scope: "sitemap-pages",
  },
  {
    id: "company-boards-unpublished-holders",
    // The DONE of the prod rollout that carries company-board-unpublished-people.
    at: null,
    what:
      "„Obecny skład” lists a company's unpublished current holders to a " +
      "logged-out reader (and so to a crawler), their party behind a sign in.",
    scope: "boards-with-unpublished-holders",
  },
];

/** A node, as much of it as this reads. */
export type NodeRow = {
  type?: unknown;
  name?: unknown;
  published?: unknown;
  deleted?: unknown;
  revision_id?: unknown;
  [CONTENT_CHANGED_AT]?: unknown;
};

/** An `employed` edge, as much of it as this reads. */
export type EdgeRow = {
  source?: unknown;
  target?: unknown;
  end_date?: unknown;
  deleted?: unknown;
  revision_id?: unknown;
};

/** One unpublished holder of a post held today at a live company: the
 * documents whose provenance decides whether the board lists them. */
export type BoardCandidate = { company: string; person: string; edge: string };

/** The posts held today at live companies whose holder has no live page -
 * the holders `/api/edges/successions` considers for a logged-out reader
 * before it asks `importedOrReviewed`. Held today is an end date that is null
 * or "", as the endpoint reads it; a removed holder is never listed. */
export function boardCandidates(
  nodes: ReadonlyMap<string, NodeRow>,
  edges: ReadonlyMap<string, EdgeRow>,
): BoardCandidate[] {
  const candidates: BoardCandidate[] = [];
  for (const [edgeId, edge] of edges) {
    if (edge.deleted === true || edge.end_date) continue;
    if (typeof edge.source !== "string" || typeof edge.target !== "string") {
      continue;
    }
    const company = nodes.get(edge.target);
    if (!company || company.type !== "place" || !pageIsPublic(company)) {
      continue;
    }
    const person = nodes.get(edge.source);
    if (
      !person ||
      person.type !== "person" ||
      typeof person.name !== "string" ||
      !person.name ||
      person.deleted === true ||
      pageIsPublic(person)
    ) {
      continue;
    }
    candidates.push({
      company: edge.target,
      person: edge.source,
      edge: edgeId,
    });
  }
  return candidates;
}

/** The companies whose board lists at least one of `candidates`: those whose
 * person and post an import wrote or a reviewer approved (`shown`, the ids
 * `importedOrReviewed` passed). */
export function boardCompanies(
  candidates: readonly BoardCandidate[],
  shown: ReadonlySet<string>,
): Set<string> {
  return new Set(
    candidates
      .filter(({ person, edge }) => shown.has(person) && shown.has(edge))
      .map(({ company }) => company),
  );
}

/** Which of `pages` a stamp at `at` would move: those with no
 * `content_changed_at`, or an older one. ISO strings in UTC compare as
 * instants. */
export function stampPlan(
  pages: Iterable<string>,
  nodes: ReadonlyMap<string, NodeRow>,
  at: string,
): { write: string[]; unchanged: number } {
  const write: string[] = [];
  let unchanged = 0;
  const target = new Date(at).toISOString();
  for (const id of pages) {
    const stored = nodes.get(id)?.[CONTENT_CHANGED_AT];
    if (typeof stored === "string" && stored >= target) unchanged++;
    else write.push(id);
  }
  return { write, unchanged };
}

/** `importedOrReviewed` over many documents, a slice at a time: it sends one
 * query per document with no approved revision, all at once. Fifty at a time
 * because the emulator a dry run is rehearsed on scans the revisions for each
 * one: fifty took 5 s against the 10-24 export, two hundred at once 286 s. */
async function provenanceOf(
  db: Firestore,
  docs: { id: string; revision_id?: unknown }[],
): Promise<Set<string>> {
  const shown = new Set<string>();
  const SLICE = 50;
  for (let i = 0; i < docs.length; i += SLICE) {
    for (const id of await importedOrReviewed(db, docs.slice(i, i + SLICE))) {
      shown.add(id);
    }
    if ((i / SLICE) % 40 === 39) {
      console.log(
        `  provenance: ${Math.min(i + SLICE, docs.length)} of ${docs.length}`,
      );
    }
  }
  return shown;
}

async function pagesOf(
  db: Firestore,
  scope: SiteChangeScope,
  nodes: ReadonlyMap<string, NodeRow>,
): Promise<string[]> {
  if (scope === "sitemap-pages") {
    return [...nodes].filter(([, node]) => inSitemap(node)).map(([id]) => id);
  }

  const edgesSnap = await db
    .collection("edges")
    .where("type", "==", "employed")
    .select("source", "target", "end_date", "deleted", "revision_id")
    .get();
  const edges = new Map<string, EdgeRow>(
    edgesSnap.docs.map((doc) => [doc.id, doc.data() as EdgeRow]),
  );
  const candidates = boardCandidates(nodes, edges);
  console.log(
    `  ${edges.size} employed relation(s); ${candidates.length} post(s) held ` +
      "today by an unpublished holder at a live company.",
  );

  const people = [...new Set(candidates.map((c) => c.person))];
  const shown = await provenanceOf(db, [
    ...people.map((id) => ({ id, revision_id: nodes.get(id)?.revision_id })),
    ...candidates.map((c) => ({
      id: c.edge,
      revision_id: edges.get(c.edge)?.revision_id,
    })),
  ]);
  return [...boardCompanies(candidates, shown)];
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const changeFlag = process.argv.indexOf("--change");
  const asked = changeFlag >= 0 ? process.argv[changeFlag + 1] : undefined;

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

  const changes = SITE_CHANGES.filter((c) => !asked || c.id === asked);
  if (asked && changes.length === 0) {
    throw new Error(
      `No site change "${asked}". Known: ${SITE_CHANGES.map((c) => c.id).join(", ")}`,
    );
  }

  const nodesSnap = await db
    .collection("nodes")
    .select(
      "type",
      "name",
      "published",
      "deleted",
      "revision_id",
      CONTENT_CHANGED_AT,
    )
    .get();
  const nodes = new Map<string, NodeRow>(
    nodesSnap.docs.map((doc) => [doc.id, doc.data() as NodeRow]),
  );
  console.log(`Read ${nodes.size} node(s).`);

  const remaining: Record<string, number> = {};
  for (const change of changes) {
    if (!change.at) {
      console.log(
        `\n${change.id}: not live yet, no instant to stamp - skipped.`,
      );
      remaining[change.id] = 0;
      continue;
    }
    console.log(`\n${change.id} (${change.at}): ${change.what}`);
    const pages = await pagesOf(db, change.scope, nodes);
    const { write, unchanged } = stampPlan(pages, nodes, change.at);
    const at = new Date(change.at).toISOString();
    console.log(
      `  ${pages.length} page(s) reached; ${unchanged} already dated at or ` +
        `after it; ${commit ? "writing" : "would write"} ${write.length}.`,
    );
    remaining[change.id] = write.length;

    if (!commit) continue;
    for (let i = 0; i < write.length; i += 400) {
      const batch = db.batch();
      for (const id of write.slice(i, i + 400)) {
        batch.update(db.collection("nodes").doc(id), {
          [CONTENT_CHANGED_AT]: at,
        });
        // So a later change in this run compares against what was just written.
        nodes.set(id, { ...nodes.get(id), [CONTENT_CHANGED_AT]: at });
      }
      await batch.commit();
    }
    console.log(`  wrote ${write.length}.`);
  }

  if (!commit) reportRemaining(remaining);
}

// Importable by the tests, which check who is reached and what would be
// written without touching Firestore. Same guard as `fix-stale-seats.ts`.
if (process.argv[1]?.endsWith("stamp-site-changes.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
