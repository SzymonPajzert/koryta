import { getEdges } from "~~/shared/graph/util";
import { fetchEdges } from "~~/server/utils/fetch";

export default defineEventHandler(async () => {
  const [edgesFromDB] = await Promise.all([fetchEdges()]);

  const edges = getEdges(edgesFromDB);

  return edges;
});
