import { z } from "zod";
import { fetchNodes } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";

const queryValidator = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().optional().default(10),
});

export default authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const [people, places, regions] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("region"),
  ]);

  const allNodes = [
    ...Object.values(people),
    ...Object.values(places),
    ...Object.values(regions),
  ];

  let results = allNodes;

  if (query.q) {
    const searchTerm = query.q.toLowerCase();
    results = allNodes.filter(
      (node) => node.name && node.name.toLowerCase().includes(searchTerm),
    );
  }

  // Sort: maybe shorter names first if it's a match, or just take first N
  results = results.slice(0, query.limit);

  return results.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
  }));
});
