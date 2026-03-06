import { authCachedEventHandler } from "~~/server/utils/handlers";

import { fetchNodes } from "~~/server/utils/fetch";

export default authCachedEventHandler(async () => {
  const [people, places, articles, regions] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("article"),
    fetchNodes("region"),
  ]);

  const nodes = { ...people, ...places, ...articles, ...regions };
  return { nodes };
});
