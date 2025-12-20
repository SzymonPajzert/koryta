import { fetchNodes } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";
import type { NodeType } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const user = await getUser(event).catch(() => null);
  
  // We don't know the type from the ID alone easily without a lookup or passing it.
  // However, `fetchNodes` currently takes a type. 
  // We can traverse all types or pass the type as a query param or infer it.
  // Ideally, the frontend knows the type. Let's assume the frontend passes 'type' query param.
  const query = getQuery(event);
  const type = query.type as NodeType;

  if (!type || !id) {
    throw createError({ statusCode: 400, statusMessage: "Missing type or id" });
  }

  // fetchNodes returns a Record<string, data>.
  // We can filter efficiently? fetchNodes queries by type.
  // Then we find the specific ID.
  // Optimization: fetchNodes fetches ALL nodes of a type. This is inefficient for a single node.
  // But given current params, fetchNodes is designed for lists.
  // We should create a fetchNode(singular) util or modify fetchNodes to accept an ID filter.
  // Let's modify fetchNodes to support ID filter or just fetch all and pick one (not scalable but safe for now given small data).
  // Actually, let's just use the current fetchNodes and select the one.
  // Better: Upgrade fetchNodes to support single ID based fetch.

  const nodes = await fetchNodes(type, {}, !!user, id);
  const node = nodes[id];

  if (!node) {
     throw createError({ statusCode: 404, statusMessage: "Node not found" });
  }

  return { node };
});
