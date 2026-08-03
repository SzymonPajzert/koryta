import { z } from "zod";
import { parseNodeDoc, logEventPath } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getValidatedQuery } from "h3";
import { adminFirestore } from "~~/server/utils/firebase";

const queryValidator = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().optional().default(20),
});

type node = {
  id: string;
  name: string;
  type: string;
  teryt?: string;
  visibility: boolean;
};

export default authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = adminFirestore();

  const firebaseQuery: FirebaseFirestore.Query = db
    .collection("nodes")
    .where("type", "in", ["person", "place", "region"])
    // It's set by the function / computeNodes
    .where("nameChunksLower", "array-contains", query.q.toLowerCase())
    .orderBy("stats.nodeGroupSize", "desc")
    .limit(query.limit);

  const nodes = await firebaseQuery.get();
  const results = nodes.docs.map(parseNodeDoc<node>);

  logEventPath("search", query.q || "", {
    collection: "nodes",
    size: results.length,
  });
  return results.map((node) => {
    // The query that opens the table on this hit. A place is named by its node
    // id rather than by its KRS number, so that a ministry or an urząd - which
    // has none - opens filtered rather than on the whole table.
    const query: Record<string, string> = {};
    if (node.type === "place") query.place = node.id;
    if (node.teryt) query.teryt = node.teryt;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      ...(Object.keys(query).length > 0 ? { query } : {}),
    };
  });
});
