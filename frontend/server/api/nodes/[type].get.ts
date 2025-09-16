import { fetchNodes } from "~~/server/utils/fetch";
import type { NodeType } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const nodeType = getRouterParam(event, 'type')
  if (!nodeType) return undefined;
  const entities = await fetchNodes(nodeType as NodeType);
  return { entities }
});
