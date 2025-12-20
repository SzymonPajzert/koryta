import { fetchNodes } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";
import type { NodeType } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const user = await getUser(event).catch(() => null);
  
  const query = getQuery(event);
  const type = query.type as NodeType;

  if (!type || !id) {
    throw createError({ statusCode: 400, statusMessage: "Missing type or id" });
  }

  const nodes = await fetchNodes(type, !!user, id);
  const node = nodes[id];

  if (!node) {
     throw createError({ statusCode: 404, statusMessage: "Node not found" });
  }

  return { node };
});
