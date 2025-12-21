import { fetchNodes } from "~~/server/utils/fetch";
import type { NodeType } from "~~/shared/model";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const nodeType = getRouterParam(event, "type");
  if (!nodeType) return undefined;
  
  const user = await getUser(event).catch(() => null);
  const entities = await fetchNodes(nodeType as NodeType, { isAuth: !!user });
  return { entities };
});
