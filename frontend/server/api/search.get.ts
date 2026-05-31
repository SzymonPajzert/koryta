import { z } from "zod";
import { parseNodeDoc, logEventPath } from "~~/server/utils/fetch";
import { getFirestore } from "firebase-admin/firestore";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getValidatedQuery } from "h3";

const queryValidator = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().optional().default(10),
});

type node = {
  id: string;
  name: string;
  type: string;
  visibility: boolean;
};

export default authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  const firebaseQuery: FirebaseFirestore.Query = db
    .collection("nodes")
    .where("type", "in", ["person", "place", "region"])
    // It's set by the function / computeNodes
    .where("nameChunksLower", "array-contains", query.q?.toLowerCase())
    .limit(query.limit);

  const nodes = await firebaseQuery.get();
  const results = nodes.docs.map(parseNodeDoc<node>);

  logEventPath("search", query.q || "", {
    collection: "nodes",
    size: results.length,
  });
  return results.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
  }));
});
