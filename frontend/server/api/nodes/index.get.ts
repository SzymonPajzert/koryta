import { fetchNodes } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const user = await getUser(event).catch(() => null);
  const isAuth = !!user;
  
  const [people, places, articles] = await Promise.all([
      fetchNodes("person", isAuth),
      fetchNodes("place", isAuth),
      fetchNodes("article", isAuth)
  ]);

  const nodes = { ...people, ...places, ...articles };

  return { nodes };
});
