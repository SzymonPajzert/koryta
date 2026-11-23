/* eslint-disable @typescript-eslint/no-explicit-any */
// TODO remove this and fix the typing

import { z } from "zod";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import {
  dropDraftStats,
  dropSearchIndex,
  fetchNodes,
  fetchOptionsValidator,
  paginate,
} from "~~/server/utils/fetch";
import {
  buildStructuralFilterOps,
  matchedTargets,
  placeNames,
  type NodeFilterOp,
} from "~~/server/utils/nodeFilters";
import {
  isIndexError,
  ListMemo,
  readMatching,
  warnMissingIndex,
} from "~~/server/utils/nodeScan";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { getUser } from "~~/server/utils/auth";
import { nodeTypes, pageIsPublic } from "~~/shared/model";
import { defineEventHandler } from "h3";
import { logger } from "firebase-functions/logger";

const queryValidator = z.object({
  // We use generic fetch options for pagination
  ...fetchOptionsValidator.shape,

  type: z.enum(nodeTypes).optional(),
  // TODO: remove party in the future
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  companyTeryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  place: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  hideVoted: z.enum(["all", "no_votes", "has_votes"]).optional(),
  currentlyEmployed: z.enum(["all", "any", "selected"]).optional(),
  minEmploymentDate: z.string().optional(),
  minVotes: z.coerce.number().optional(),
  queueTier: z.coerce.number().optional(),
  election: z.union([z.string(), z.array(z.string())]).optional(),
  electionResult: z.enum(["won", "lost"]).optional(),
  /** One page by its id, as a row like any other: what /eksploruj/nowe asks
   * for when its url names somebody the queue has moved past. */
  id: z.string().min(1).optional(),

  // Sorting parameters
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

export type Query = z.infer<typeof queryValidator>;

// We wrap the original logic in a cached handler to preserve the caching
// for endpoints that rely on the old behavior (e.g. useEntities).
//
// `editorFresh`, and both layers of cache have to give way for it to mean
// anything: the response cache here, and `fetchNodes`'s own hour-long one
// underneath. An editor who has just created a topic asks this endpoint for the
// list to pick it from, and was handed a list from before they made it.
const cachedHandler = editorFreshCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );
  const latest = await wantsLatest(event);

  const opts = {
    personParties: query.parties || query.party,
    bypassCache: latest,
  };

  // The typeless caller is rejected before we get here, so there is always a
  // type to fetch.
  const nodes = await fetchNodes(query.type!, opts);
  return { nodes: latest ? nodes : publicNodes(nodes) };
});

/** The pages anybody may read, as anybody may read them.
 *
 * This answered every caller with the whole collection and left it to the
 * client to hide the drafts: on 2026-10-14 `?type=person` handed a logged out
 * curl 11.4 MB, 10,904 people of whom 9,653 were unpublished and 2,657 carried
 * a party. `useEntitiesFiltering` drops the same pages in the browser, so the
 * public page draws what it always drew. Filtered here, after `fetchNodes`,
 * rather than in its query, so that its one cache entry per type goes on
 * serving both kinds of reader.
 */
function publicNodes<N extends { visibility?: boolean }>(
  nodes: Record<string, N>,
): Record<string, N> {
  return Object.fromEntries(
    Object.entries(nodes)
      .filter(([, node]) => node.visibility === true)
      .map(([id, node]) => [id, dropDraftStats(node)]),
  );
}

type NodeRow = { id: string; [field: string]: any };

function approvedOp(approved: boolean): NodeFilterOp {
  return {
    applyFs: (q) => q.where("stats.isApproved", "==", approved),
    applyMem: (nodes) => nodes.filter((n) => n.stats?.isApproved === approved),
    fields: ["stats.isApproved"],
    name: "visibility",
    base: true,
  };
}

function humanVotedOp(voted: boolean): NodeFilterOp {
  return {
    applyFs: (q) => q.where("stats.votes.humanVoted", "==", voted),
    applyMem: (nodes) =>
      nodes.filter((n) => n.stats?.votes?.humanVoted === voted),
    fields: ["stats.votes.humanVoted"],
    name: "hideVoted",
  };
}

function buildSortOp(
  sortBy: string,
  desc: boolean,
  signedIn: boolean,
): NodeFilterOp {
  let sortField = sortBy;
  if (sortField === "experience") {
    sortField = signedIn
      ? "stats.edges.all.experienceMonths"
      : "stats.edges.approved.experienceMonths";
  } else if (sortField === "latestEmploymentStart") {
    sortField = signedIn
      ? "stats.edges.all.latestEmploymentStart"
      : "stats.edges.approved.latestEmploymentStart";
  } else if (sortField === "notesCount") {
    sortField = "stats.notesCount";
  } else if (sortField === "factsCount") {
    sortField = "stats.factsCount";
  } else if (sortField === "visibility") {
    sortField = "stats.isApproved";
  } else if (sortField.startsWith("votes.")) {
    sortField = `stats.votes.${sortField.split(".")[1]}`;
  }

  const direction = desc ? "desc" : "asc";
  return {
    applyFs: (q) => q.orderBy(sortField, direction),
    applyMem: (nodes) => {
      return [...nodes].sort((a, b) => {
        const getVal = (obj: any, path: string) =>
          path.split(".").reduce((o, i) => o?.[i], obj);
        const valA = getVal(a, sortField);
        const valB = getVal(b, sortField);

        if (valA === valB) return 0;
        if (valA === undefined || valA === null)
          return direction === "desc" ? 1 : -1;
        if (valB === undefined || valB === null)
          return direction === "desc" ? -1 : 1;

        const res = valA > valB ? 1 : -1;
        return direction === "desc" ? -res : res;
      });
    },
    fields: [sortField],
    name: "sort",
  };
}

function toNodeRow(doc: FirebaseFirestore.QueryDocumentSnapshot): NodeRow {
  const data = dropSearchIndex(doc.data());
  if (data.revision_id) {
    if (typeof data.revision_id.path === "string") {
      data.revision_id = data.revision_id.path;
    } else if (
      data.revision_id._path &&
      Array.isArray(data.revision_id._path.segments)
    ) {
      data.revision_id = data.revision_id._path.segments.join("/");
    }
  }
  return { id: doc.id, ...data, visibility: pageIsPublic(data) };
}

/** A page merged away keeps its document - `deleted: true`, `merged_into`,
 * see server/utils/merge.ts - so its url still resolves and the votes and
 * revisions filed against it still hang off something. `pageIsPublic` takes
 * it off the public site, and that was assumed to be enough; it is not.
 * `visibility=private` means `stats.isApproved == false`, which is exactly
 * the bucket a tombstone falls into, so to a logged-in editor all 171
 * people merged on 2026-08-31 were still rows in /eksploruj/tabela.
 *
 * In memory rather than in the query because Firestore cannot express it:
 * `deleted` is absent on the other 15,597 nodes, so neither `== false` nor
 * `!= true` matches them, and a mem-only op here would push the sort and
 * every structural filter out of their indexes - reading all 8,277
 * unpublished people to serve a page of ten. The price is that when the
 * query did run indexed, the page can come back a row short and `total`
 * still counts the tombstones. That is 171 in 8,277, which is the cheaper
 * of the two errors by a wide margin. */
function notMergedAway(node: NodeRow): boolean {
  return (node as { deleted?: boolean }).deleted !== true;
}

/** The page and the count straight from Firestore, or null when it has no
 * index for the query and the list has to be put together in memory. */
async function readIndexedPage(
  db: FirebaseFirestore.Firestore,
  ops: NodeFilterOp[],
  sortOp: NodeFilterOp | undefined,
  query: Query,
): Promise<{ rows: NodeRow[]; total: number } | null> {
  let fsQuery: FirebaseFirestore.Query = db.collection("nodes");
  for (const op of ops) {
    fsQuery = op.applyFs(fsQuery);
  }
  if (sortOp) {
    fsQuery = sortOp.applyFs(fsQuery);
  }
  try {
    const [snap, countSnap] = await Promise.all([
      paginate(fsQuery, query).get(),
      fsQuery.count().get(),
    ]);
    return {
      rows: snap.docs.map(toNodeRow).filter(notMergedAway),
      total: countSnap.data().count,
    };
  } catch (error) {
    if (!isIndexError(error)) throw error;
    warnMissingIndex("api/nodes", sortOp ? [...ops, sortOp] : ops, error);
    return null;
  }
}

/** Public lists put together in memory, for ten minutes: the home map's
 * województwo lists are read a page at a time, and each page was a fresh read
 * of every person, 3.79M of prod's 9.7M large reads on the morning of
 * 2026-11-23. A newly published person can take that long to join a list. */
const publicLists = new ListMemo<NodeRow>(10 * 60 * 1000, 15_000);

const PAGING = new Set(["page", "limit", "sortBy", "sortDesc"]);

/** What a public list holds, whatever page of it or order is asked. */
function listKey(query: Query): string {
  return JSON.stringify(
    Object.entries(query)
      .filter(([key]) => !PAGING.has(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  // Without a type this merges all four collections into one ~16 MB response.
  // Cloud CDN will not store anything over 10 MiB, so it can never be cached
  // and every caller pays full origin egress for the entire database.
  //
  // Nothing in the app asks for it that way - every caller sets a type
  // (app/composables/entity.ts, app/components/form/EntityPicker.vue) or goes
  // through the paginated path below (app/composables/entity/listWithStats.ts).
  // Logged rather than silently rejected so that a caller we have not accounted
  // for shows up somewhere we will see it.
  if (!query.type) {
    logger.warn("[api/nodes] rejected typeless request", {
      referer: getRequestHeader(event, "referer"),
      userAgent: getRequestHeader(event, "user-agent"),
    });
    throw createError({ statusCode: 400, message: "Missing type" });
  }

  // If pagination/sorting is requested, query Firestore directly for uncached results
  if (query.limit || query.sortBy) {
    const user = await getUser(event).catch(() => null);
    const db = getFirestore("koryta-pl");

    const edgeScope = user ? "all" : "approved";
    const { ops, empty, targetIds } = await buildStructuralFilterOps(
      db,
      query,
      edgeScope,
    );
    if (empty) {
      return { nodes: {}, total: 0 };
    }

    // First, so the missing-index fallback, which moves ops into memory from
    // the end, never trades a one-document read for the whole type.
    const id = query.id;
    if (id) {
      ops.unshift({
        applyFs: (q) => q.where(FieldPath.documentId(), "==", id),
        applyMem: (nodes) => nodes.filter((n) => n.id === id),
        name: "id",
      });
    }

    if (!user) {
      if (query.visibility === "private") {
        return { nodes: {}, total: 0 };
      }
      ops.push(approvedOp(true));
    } else if (query.visibility === "public") {
      ops.push(approvedOp(true));
    } else if (query.visibility === "private") {
      ops.push(approvedOp(false));
    }

    if (query.hideVoted === "no_votes") {
      ops.push(humanVotedOp(false));
    } else if (query.hideVoted === "has_votes") {
      ops.push(humanVotedOp(true));
    }

    const sortOp = query.sortBy
      ? buildSortOp(query.sortBy, query.sortDesc === "true", !!user)
      : undefined;

    let nodesArray: NodeRow[];
    let total: number;
    const indexed = ops.some((op) => op.memoryOnly)
      ? null
      : await readIndexedPage(db, ops, sortOp, query);
    if (indexed) {
      ({ rows: nodesArray, total } = indexed);
    } else {
      let rows = user ? undefined : publicLists.get(listKey(query));
      if (!rows) {
        const { docs } = await readMatching(db, ops, { label: "api/nodes" });
        rows = docs.map(toNodeRow);
        for (const op of ops) {
          rows = op.applyMem(rows);
        }
        rows = rows.filter(notMergedAway);
        // Signed-in readers read back their own votes and publications from
        // these lists, so only the public ones are kept.
        if (!user) publicLists.set(listKey(query), rows);
      }
      if (sortOp) {
        rows = sortOp.applyMem(rows);
      }
      total = rows.length;
      const page = query.page || 1;
      const limit = query.limit || rows.length;
      const offset = (page - 1) * limit;
      nodesArray = rows.slice(offset, offset + limit);
    }

    const nodesRecord: Record<string, unknown> = {};
    for (const node of nodesArray) {
      // Published pages only, by the filter above, and still not their
      // unpublished relations - see `dropDraftStats`.
      nodesRecord[node.id] = user ? node : dropDraftStats(node);
    }

    // Only beside a company or region filter, and only for the page being
    // returned: which employers and regions put each row here, so the table
    // can mark them, and the names of the companies among them, for a row
    // that reached one only through the company it works for. Present but
    // empty means the filters are set and nothing the rows hold matched them.
    if (targetIds) {
      const matched = matchedTargets(
        nodesArray,
        targetIds,
        edgeScope,
        query.currentlyEmployed,
      );
      return {
        nodes: nodesRecord,
        total,
        matched,
        matchedPlaces: await placeNames(
          db,
          Object.values(matched).flat(),
          !!user,
        ),
      };
    }

    return { nodes: nodesRecord, total };
  }

  // Fallback to the original cached behavior if no limit/sortBy is provided
  return cachedHandler(event);
});
