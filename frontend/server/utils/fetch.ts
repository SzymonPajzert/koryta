import {
  type NodeType,
  type Edge,
  type Person,
  type Company,
  type Article,
  type Region,
  type Topic,
  pageIsPublic,
} from "~~/shared/model";
import { candidacyDay } from "~~/shared/electionDays";
import { getFirestore, Filter } from "firebase-admin/firestore";
import { z } from "zod";

/** Positive whole numbers only. Firestore throws on a negative or fractional
 * limit or offset, and until this said so that surfaced as a 500 - `limit=-1`
 * being what Vuetify's "all rows" option asks for. */
export const fetchOptionsValidator = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export type FetchOptions = z.infer<typeof fetchOptionsValidator>;

export function paginate(
  query: FirebaseFirestore.Query,
  options: FetchOptions,
): FirebaseFirestore.Query {
  let paginatedQuery = query;
  if (options.limit) {
    const page = options.page || 1;
    // The same rule as `fetchOptionsValidator`, for the routes that validate
    // their query with a schema of their own: a 400 rather than Firestore's
    // throw, which is a 500.
    if (!isPositiveInteger(options.limit) || !isPositiveInteger(page)) {
      throw createError({
        statusCode: 400,
        message: "limit i page muszą być dodatnimi liczbami całkowitymi.",
      });
    }
    const offset = (page - 1) * options.limit;
    paginatedQuery = paginatedQuery.offset(offset).limit(options.limit);
  }
  return paginatedQuery;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

interface nodeData {
  person: Person;
  place: Company;
  article: Article;
  region: Region;
  topic: Topic;
}

export type NodeDataUnion = nodeData[keyof nodeData];

export interface FetchNodesOptions {
  nodeId?: string;
  personParties?: string | string[];
  bypassCache?: boolean;
}

export function applyPartiesFilter(
  query: FirebaseFirestore.Query,
  parties: string | string[],
): FirebaseFirestore.Query {
  const partiesToSearch = Array.isArray(parties) ? parties : [parties];
  const hasNone = partiesToSearch.includes("__NONE__");
  const normalParties = partiesToSearch.filter((p) => p !== "__NONE__");

  const partyFilters = [];

  if (normalParties.length > 0) {
    partyFilters.push(
      Filter.where("parties", "array-contains-any", normalParties),
    );
  }
  if (hasNone) {
    partyFilters.push(Filter.where("parties", "==", []));
  }

  if (partyFilters.length === 1) {
    return query.where(partyFilters[0]!);
  } else if (partyFilters.length > 1) {
    return query.where(Filter.or(...partyFilters));
  }
  return query;
}

/** A node document's fields, less the search index. Mutates and returns
 * `data`, which is always a fresh `doc.data()`.
 *
 * `nameChunksLower` is every prefix of every word of the name, written by the
 * `onNodeWritten` trigger so /api/search can match on it with
 * `array-contains` - a query, which never needs the field handed back. Nothing
 * outside the server reads it, and it went out with every node anyway: 59% of
 * the bytes of `/api/nodes?type=place`, and a share of every graph, table and
 * entity response. */
export function dropSearchIndex(
  data: FirebaseFirestore.DocumentData,
): FirebaseFirestore.DocumentData {
  delete data.nameChunksLower;
  return data;
}

/** How many ids a stored list holds, read tolerantly: `sanitizeFirestoreData`
 * stores a list written from inside another as a map with numbered keys. */
function idCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

/** A node document as somebody who may not see drafts is to be shown it: its
 * `stats.edges.all` taken off. Returns a copy; `data` is left as it was, since
 * it can be an entry of `fetchNodes`'s cache.
 *
 * `all` is `approved` with the unpublished relations counted in, and its
 * `targetNodeIds` names what they point at - the company of an employment
 * nobody has reviewed, the region a candidacy was in. A reader who may not see
 * a relation may not see where it leads either, and a published page carries
 * `all` as much as a draft does.
 *
 * One number survives it, as `hiddenTargets`: how many more there are, which
 * is what the logged-out table says to invite a sign-in ("W tym widoku
 * znaleźliśmy jeszcze...") and all it ever read `all` for. A count says that
 * there is more without saying what.
 */
export function dropDraftStats<T extends FirebaseFirestore.DocumentData>(
  data: T,
): T {
  const edges = data.stats?.edges;
  if (!edges || typeof edges !== "object" || !("all" in edges)) return data;
  const { all, ...rest } = edges;
  const hiddenTargets = Math.max(
    0,
    idCount(all?.targetNodeIds) - idCount(rest.approved?.targetNodeIds),
  );
  return {
    ...data,
    stats: { ...data.stats, edges: { ...rest, hiddenTargets } },
  };
}

export function parseNodeDoc<T extends { id?: string; visibility?: boolean }>(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): T {
  const data = dropSearchIndex(doc.data());
  if (data.revision_id && typeof data.revision_id.path === "string") {
    data.revision_id = data.revision_id.path;
  }
  return {
    id: doc.id,
    ...data,
    visibility: pageIsPublic(data),
  } as T;
}

export async function fetchNodes<N extends NodeType>(
  path: N,
  options: FetchNodesOptions = {},
): Promise<Record<string, nodeData[N]>> {
  return (await _cachedFetchNodes(path, options)) as Record<
    string,
    nodeData[N]
  >;
}

const _cachedFetchNodes = defineCachedFunction(
  async (path: string, options: FetchNodesOptions = {}) => {
    const { nodeId } = options;
    const db = getFirestore("koryta-pl");
    let query: FirebaseFirestore.Query = db
      .collection("nodes")
      .where("type", "==", path);

    if (options.personParties) {
      query = applyPartiesFilter(query, options.personParties);
    }

    if (nodeId) {
      const docRef = db.collection("nodes").doc(nodeId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return {};
      if (docSnap.data()?.type !== path) return {};

      const data = dropSearchIndex(docSnap.data() || {});
      if (data.revision_id && typeof data.revision_id.path === "string") {
        data.revision_id = data.revision_id.path;
      }

      return { [nodeId]: { id: docSnap.id, ...data } };
    }

    const nodes = await query.get();
    const nodesData = nodes.docs
      // A page merged away is still a document, so that its url resolves - see
      // server/utils/merge.ts. It is not still an entity: leaving it in here
      // offered it in the edit form's picker under the old name and counted it
      // in the category and region lookups nodeFilters.ts builds from this
      // cache. Filtered after the query because `deleted` is absent on a live
      // node, which no Firestore predicate can ask about; this path already
      // reads the whole collection, so it costs nothing.
      .filter((doc) => doc.data().deleted !== true)
      .map(parseNodeDoc);

    return Object.fromEntries(nodesData.map((node) => [node.id, node]));
  },
  {
    maxAge: 3600, // 1 hour
    name: "fetchNodes",
    getKey: (path: string, options?: FetchNodesOptions) => {
      const p = options?.personParties
        ? Array.isArray(options.personParties)
          ? options.personParties.join(",")
          : options.personParties
        : "all";
      return `${path}-${options?.nodeId || "all"}-${p}`;
    },
    shouldBypassCache: (path: string, options?: FetchNodesOptions) =>
      !!options?.bypassCache,
  },
);

function edgeFromDB(doc: FirebaseFirestore.QueryDocumentSnapshot): Edge {
  const data = doc.data();
  if (data.revision_id && typeof data.revision_id.path === "string") {
    data.revision_id = data.revision_id.path;
  }

  // A candidacy is stored under its election's year; the page shows the day.
  if (data.type === "election") {
    if (typeof data.start_date === "string" && data.start_date) {
      data.start_date = candidacyDay(data.start_date, data.position);
    }
    data["end_date"] = data["start_date"];
  }

  return {
    id: doc.id,
    ...data,
    content: data.content || data.text || "",
    references: data.references || [],
    visibility: pageIsPublic(data),
  } as Edge;
}

/** Fetches edges connected to specific nodes */
export async function fetchEdgesClose(
  centerNodeIds: string | string[],
): Promise<Edge[]> {
  const ids = Array.isArray(centerNodeIds) ? centerNodeIds : [centerNodeIds];
  if (ids.length === 0) return [];

  const db = getFirestore("koryta-pl");
  const chunkSize = 30; // Firestore 'in' query limit is 30

  const edgesMap = new Map<string, Edge>();

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    // Fetch edges where these nodes are the source
    const sourceQuery = db
      .collection("edges")
      .where("source", "in", chunk)
      .get();

    // Fetch edges where these nodes are the target
    const targetQuery = db
      .collection("edges")
      .where("target", "in", chunk)
      .get();

    const [sourceSnap, targetSnap] = await Promise.all([
      sourceQuery,
      targetQuery,
    ]);

    for (const doc of sourceSnap.docs) {
      if (!edgesMap.has(doc.id)) {
        edgesMap.set(doc.id, edgeFromDB(doc));
      }
    }

    for (const doc of targetSnap.docs) {
      if (!edgesMap.has(doc.id)) {
        edgesMap.set(doc.id, edgeFromDB(doc));
      }
    }
  }

  return Array.from(edgesMap.values());
}

export async function fetchEdges(): Promise<Edge[]> {
  const db = getFirestore("koryta-pl");
  const edges = (await db.collection("edges").get()).docs.map(edgeFromDB);
  return edges as unknown as Edge[];
}

export async function fetchNodesByIds(
  nodeIds: string[],
): Promise<NodeDataUnion[]> {
  if (nodeIds.length === 0) return [];
  const db = getFirestore("koryta-pl");
  const uniqueIds = Array.from(new Set(nodeIds));
  const nodes = [];

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    const refs = chunk.map((id) => db.collection("nodes").doc(id));
    const snaps = await db.getAll(...refs);

    nodes.push(
      ...snaps
        .filter((snap) => snap.exists)
        .map((snap) =>
          parseNodeDoc<NodeDataUnion>(
            snap as FirebaseFirestore.QueryDocumentSnapshot,
          ),
        ),
    );
  }

  return nodes;
}
