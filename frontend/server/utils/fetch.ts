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
import { getFirestore } from "firebase-admin/firestore";

interface nodeData {
  person: Person;
  place: Company;
  article: Article;
  region: Region;
  record: unknown;
}

export interface FetchNodesOptions {
  nodeId?: string;
  personParty?: string;
}

function logEventPath(func: string, args: string) {
  try {
    const event = useEvent();
    console.info(
      `[Firestore Read][${func}] [${func}(${args}) triggered by: ${event?.path || "unknown"}`,
    );
  } catch {
    console.info(
      `[Firestore Read][${func}] [${func}(${args}) triggered outside request context`,
    );
  }
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
    logEventPath("fetchNodes", path);

    const { nodeId } = options;
    const db = getFirestore("koryta-pl");
    let query: FirebaseFirestore.Query = db
      .collection("nodes")
      .where("type", "==", path);
    if (options.personParty) {
      query = query.where("parties", "array-contains", options.personParty);
    }

    if (nodeId) {
      const docRef = db.collection("nodes").doc(nodeId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return {};
      if (docSnap.data()?.type !== path) return {};
      logEventPath("fetchNodes", path);

      const data = docSnap.data() || {};
      if (data.revision_id && typeof data.revision_id.path === "string") {
        data.revision_id = data.revision_id.path;
      }

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

    return Object.fromEntries(nodesData.map((node) => [node.id, node]));
  },
  {
    maxAge: 3600, // 1 hour
    name: "fetchNodes",
    getKey: (path: string, options?: FetchNodesOptions) =>
      `${path}-${options?.nodeId || "all"}-${options?.personParty || "all"}`,
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

export async function fetchEdges(): Promise<Edge[]> {
  return await _cachedFetchEdges();
}

const _cachedFetchEdges = defineCachedFunction(
  async () => {
    logEventPath("fetchEdges", "all");
    const db = getFirestore("koryta-pl");
    const edges = (await db.collection("edges").get()).docs.map((doc) => {
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
    });
    return edges as unknown as Edge[];
  },
  {
    maxAge: 3600, // 1 hour
    name: "fetchEdges",
  },
);

export async function fetchFirestore<T>(path: string): Promise<T> {
  const db = getDatabase();
  const snapshot = await db.ref(path).once("value");
  return snapshot.val() || {};
}
