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
import { getFirestore, Filter } from "firebase-admin/firestore";
import { z } from "zod";

export const fetchOptionsValidator = z.object({
  limit: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
});

export type FetchOptions = z.infer<typeof fetchOptionsValidator>;

export function paginate(
  query: FirebaseFirestore.Query,
  options: FetchOptions,
): FirebaseFirestore.Query {
  let paginatedQuery = query;
  if (options.limit) {
    const page = options.page || 1;
    const offset = (page - 1) * options.limit;
    paginatedQuery = paginatedQuery.offset(offset).limit(options.limit);
  }
  return paginatedQuery;
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

export function parseNodeDoc<T extends { id?: string; visibility?: boolean }>(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): T {
  const data = doc.data();
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

      const data = docSnap.data() || {};
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

const electionConcreteDate: Record<string, string> = {
  "1989": "1989-06-04",
  "1990": "1990-11-25",
  "1991": "1991-10-27",
  "1993": "1993-09-19",
  "1995": "1995-11-05",
  "1997": "1997-09-21",
  "1998": "1998-10-11",
  "2000": "2000-10-08",
  "2001": "2001-09-23",
  "2002": "2002-10-27",
  "2004": "2004-06-13",
  "2005": "2005-09-25",
  "2006": "2006-11-12",
  "2007": "2007-10-21",
  "2009": "2009-06-07",
  "2010": "2010-06-20",
  "2011": "2011-10-09",
  "2014": "2014-11-16",
  "2015": "2015-10-25",
  "2018": "2018-10-21",
  "2019": "2019-10-13",
  "2020": "2020-06-28",
  "2023": "2023-10-15",
  "2024": "2024-04-07",
};

function edgeFromDB(doc: FirebaseFirestore.QueryDocumentSnapshot): Edge {
  const data = doc.data();
  if (data.revision_id && typeof data.revision_id.path === "string") {
    data.revision_id = data.revision_id.path;
  }

  // TODO this should be organized somewhere else.
  if (data.type === "election") {
    if (data["start_date"]) {
      const year = String(data["start_date"]).substring(0, 4);
      if (electionConcreteDate[year]) {
        data["start_date"] = electionConcreteDate[year];
      }
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
