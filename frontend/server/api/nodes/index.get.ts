import { authCachedEventHandler } from "~~/server/utils/handlers";

import { fetchNodes } from "~~/server/utils/fetch";
import { z } from "zod";

const queryValidator = z.object({
  type: z.enum(["person", "place", "article", "region"]).optional(),
});

export default authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  if (query.type) {
    return { nodes: await fetchNodes(query.type) };
  }

  const [people, places, articles, regions] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("article"),
    fetchNodes("region"),
  ]);

  const nodes = { ...people, ...places, ...articles, ...regions };
  return { nodes };
});
