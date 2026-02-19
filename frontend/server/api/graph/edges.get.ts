import { getEdges } from "~~/shared/graph/util";
import { fetchEdges } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async () => {
  const [edgesFromDB] = await Promise.all([fetchEdges()]);
  const edges = getEdges(edgesFromDB);

  return edges;
});
