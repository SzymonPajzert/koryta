import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async () => {
  const [people, places, articles, regions] = await Promise.all([
    $fetch("/api/nodes/person"),
    $fetch("/api/nodes/place"),
    $fetch("/api/nodes/article"),
    $fetch("/api/nodes/region"),
  ]);

  const nodes = { ...people, ...places, ...articles, ...regions };
  return { nodes };
});
