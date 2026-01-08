import { fetchNodes } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async (event) => {
  const user = await getUser(event).catch(() => null);
  const query = getQuery(event);
  const isAuth = !!user && query?.pending === "true";

  const [people, places, articles] = await Promise.all([
    fetchNodes("person", { isAuth }),
    fetchNodes("place", { isAuth }),
    fetchNodes("article", { isAuth }),
  ]);

  const nodes = { ...people, ...places, ...articles };

  return { nodes };
});
