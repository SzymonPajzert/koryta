import { generateEntityUrl } from "~~/app/composables/slugs";
import { nodeTypes, pageIsPublic } from "~~/shared/model";

export default defineEventHandler(async () => {
  const urls: { loc: string; lastmod?: string }[] = [];

  const nodesSnapshots = await Promise.all(
    nodeTypes.map((type) => fetchNodes(type)),
  );

  nodesSnapshots.forEach((nodesSnapshot) => {
    Object.entries(nodesSnapshot).forEach(([id, data]) => {
      if (pageIsPublic(data) && data.name) {
        if (nodeTypes.includes(data.type)) {
          urls.push({
            loc: generateEntityUrl(data.type, id, data.name),
          });
        }
      }
    });
  });

  return urls;
});
