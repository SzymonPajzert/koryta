import { fetchNodes } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async (event) => {
  const user = await getUser(event).catch(() => null);
  const isAuth = !!user;

  const [people, places, articles, regions] = await Promise.all([
    fetchNodes("person", { isAuth }),
    fetchNodes("place", { isAuth }),
    fetchNodes("article", { isAuth }),
    fetchNodes("region", { isAuth }),
  ]);

  const nodes = { ...people, ...places, ...articles, ...regions };

  return { nodes };
});
