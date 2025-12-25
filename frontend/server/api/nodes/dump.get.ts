import { fetchNodes } from "~~/server/utils/fetch";
import type { NodeType } from "~~/shared/model";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const limit = Number(query.limit) || 100;
  // const group = query.group as string; // Not filtering by group yet as per fetchNodes implementation

  // For now, dump filterable nodes (people) as JSON
  const entities = await fetchNodes("person" as NodeType);

  // Basic slice for limit
  const result = Object.entries(entities)
    .slice(0, limit)
    .map(([id, data]) => ({ id, ...(data as any) }));

  return result;
});
