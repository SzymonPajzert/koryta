import { authCachedEventHandler } from "~~/server/utils/handlers";

import { getEdges } from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";

import type { Article } from "~~/shared/model";

export type SourceStat = {
  domain: string;
  articleCount: number;
  peopleCount: number;
  people: Array<string>;
  url: string | undefined;
};

export default authCachedEventHandler(async () => {
  const articles = await fetchNodes("article");
  const [edgesFromDB] = await Promise.all([fetchEdges()]);
  const edges = getEdges(edgesFromDB);

  const articleCounts: Record<string, number> = {};
  const domainMap: Record<string, string> = {}; // domain -> full url sample
  const domainPeople: Record<string, Set<string>> = {};
  const articleToDomain = new Map<string, string>();

  Object.entries(articles).forEach(([id, article]) => {
    const art = article as Article;
    if (!art.sourceURL) return;

    const url = new URL(art.sourceURL);
    const domain = url.hostname.replace("www.", "");

    articleCounts[domain] = (articleCounts[domain] || 0) + 1;
    if (!domainMap[domain]) domainMap[domain] = url.origin;
    if (!domainPeople[domain]) domainPeople[domain] = new Set();

    articleToDomain.set(id, domain);
  });

  edges.forEach((edge) => {
    if (articleToDomain.has(edge.source)) {
      const domain = articleToDomain.get(edge.source)!;
      domainPeople[domain]?.add(edge.target);
    }
    if (articleToDomain.has(edge.target)) {
      const domain = articleToDomain.get(edge.target)!;
      domainPeople[domain]?.add(edge.source);
    }
  });

  // Convert to array and sort by the number of people
  const sourceStats: SourceStat[] = Object.entries(domainPeople)
    .sort((a, b) => b[1].size - a[1].size) // Sort desc
    .map(([domain, domainPeople]) => ({
      domain,
      articleCount: articleCounts[domain] || 0,
      peopleCount: domainPeople.size || 0,
      people: Array.from(domainPeople.values() ?? []),
      url: domainMap[domain],
    }));

  return sourceStats;
});
