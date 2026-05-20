import {
  type NodeType,
  type Edge,
  type Person,
  type Company,
  type Article,
  type Region,
  pageIsPublic,
} from "~~/shared/model";
import { getDatabase } from "firebase-admin/database";
import { getFirestore, Filter } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";
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
  record: unknown;
}

export interface FetchNodesOptions {
  nodeId?: string;
  personParties?: string | string[];
  bypassCache?: boolean;
}

function getEventSafe() {
  try {
    const event = useEvent();
    const result = {
      path: event?.path,
      route: event?.context?.matchedRoute?.path,
    };
    if (result.path && result.route) {
      const queryStr = event.path.split("?", 2)[1];
      if (queryStr) {
        let safeQueryStr = queryStr;
        const paramsToSanitize = ["place", "center", "nodeId", "teryt", "id"];
        for (const param of paramsToSanitize) {
          const regex = new RegExp(`(^|&)(${param}=)[^&]*`, "g");
          safeQueryStr = safeQueryStr.replace(regex, "$1$2id");
        }
        result.route = result.route + "?" + safeQueryStr;
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

export function logEventPath(
  func: string,
  args: string,
  opts: { type?: string; collection: string; size?: number },
) {
  const event = getEventSafe();
  logger.info(
    `[Firestore Read][${func}(${args})] triggered by: ${event?.path ?? "unknown path"}]`,
    {
      ...opts,
      ...event,
      eventPath: event?.route,
    },
  );
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
      logEventPath("fetchNodes", path, { type: path, collection: "nodes" });

      const data = docSnap.data() || {};
      if (data.revision_id && typeof data.revision_id.path === "string") {
        data.revision_id = data.revision_id.path;
      }

      logEventPath("fetchNodes", path, {
        type: path,
        collection: "nodes",
        size: 1,
      });
      return { [nodeId]: { id: docSnap.id, ...data } };
    }

    const nodes = await query.get();
    const nodesData = nodes.docs.map((doc) => {
      const data = doc.data();
      if (data.revision_id && typeof data.revision_id.path === "string") {
        data.revision_id = data.revision_id.path;
      }
      return {
        id: doc.id,
        ...data,
        visibility: pageIsPublic(data),
      };
    });

    logEventPath("fetchNodes", path, {
      type: path,
      collection: "nodes",
      size: nodesData.length,
    });
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

  const edges = Array.from(edgesMap.values());

  logEventPath("fetchEdges", "close_batch", {
    collection: "edges",
    size: edges.length,
  });

  return edges;
}

export async function fetchEdges(): Promise<Edge[]> {
  const db = getFirestore("koryta-pl");
  const edges = (await db.collection("edges").get()).docs.map(edgeFromDB);
  const result = edges as unknown as Edge[];
  logEventPath("fetchEdges", "all", {
    collection: "edges",
    size: result.length,
  });
  return result;
}

export async function fetchFirestore<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {};
}
