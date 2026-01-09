import { getEdges } from "~~/shared/graph/util";
import { fetchEdges } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async (event) => {
  const user = await getUser(event).catch(() => null);
  const isAuth = !!user;
  const [edgesFromDB] = await Promise.all([fetchEdges({ isAuth })]);

  const edges = getEdges(edgesFromDB);

  return edges;
});
