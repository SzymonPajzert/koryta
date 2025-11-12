import { fetchNodes } from "~~/server/utils/fetch";
import type { NodeType } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const nodeType = getRouterParam(event, "type");
  const query = getQuery(event);
  if (!nodeType) return undefined;

  const smallQuery = { ...query };
  delete smallQuery.place;
  const entities = await fetchNodes(nodeType as NodeType, smallQuery);

  if (query.place && typeof query.place === "string") {
    const { nodeGroup } = await event.$fetch(
      `/api/graph/nodeGroups/${query.place}`,
    );
    return {
      entities: Object.fromEntries(
        Object.entries(entities).filter(([key]) =>
          nodeGroup.connected.includes(key),
        ),
      ),
    };
  }

  return { entities };
});
