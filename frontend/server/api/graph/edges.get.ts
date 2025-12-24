import { getEdges } from "~~/shared/graph/util";
import { fetchEdges } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const user = await getUser(event).catch(() => null);
  const isAuth = !!user;
  const [edgesFromDB] = await Promise.all([fetchEdges({ isAuth })]);

  const edges = getEdges(edgesFromDB);

  return edges;
});
