import { fetchNodes } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async () => {
  const regions = await fetchNodes("region");

  return Object.values(regions).map((region) => ({
    id: region.id as string,
    teryt: region.teryt,
    name: region.name,
    people: region.stats?.people || 0,
  }));
});
