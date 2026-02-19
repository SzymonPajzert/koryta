import { fetchNodes } from "~~/server/utils/fetch";
import type { NodeType } from "~~/shared/model";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async (event) => {
  const nodeType = getRouterParam(event, "type");
  if (!nodeType) return undefined;

  const entities = await fetchNodes(nodeType as NodeType);
  return { entities };
});
