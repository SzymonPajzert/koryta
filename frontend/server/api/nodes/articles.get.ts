import { authCachedEventHandler } from "~~/server/utils/handlers";

import { getEdges } from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import { z } from "zod";

import type { Article } from "~~/shared/model";

export type SourceStat = {
  domain: string;
  articleCount: number;
  peopleCount: number;
  people: Array<string>;
  url: string | undefined;
};

const responseValidator = z.array(
  z.object({
    domain: z.string(),
    articleCount: z.number(),
    peopleCount: z.number(),
    url: z.string(),
  }),
);

export default authCachedEventHandler(async () => {
  const articles = await fetchNodes("article");
  console.log(articles);
  const [edgesFromDB] = await Promise.all([fetchEdges()]);
  // console.log(edgesFromDB);
  const edges = getEdges(edgesFromDB);
  // console.log(edges);

  const counts: Record<string, number> = {};
  const domainMap: Record<string, string> = {}; // domain -> full url sample
  const domainPeople: Record<string, Set<string>> = {};
  const articleToDomain = new Map<string, string>();

  Object.entries(articles).forEach(([id, article]) => {
    const art = article as Article;
    if (!art.sourceURL) return;

    const url = new URL(art.sourceURL);
    const domain = url.hostname.replace("www.", "");

    counts[domain] = (counts[domain] || 0) + 1;
    if (!domainMap[domain]) domainMap[domain] = url.origin;
    if (!domainPeople[domain]) domainPeople[domain] = new Set();

    articleToDomain.set(id, domain);
  });

  console.log(articleToDomain);

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

  // Convert to array and sort
  const sourceStats: SourceStat[] = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]) // Sort desc
    .map(([domain, articleCount]) => ({
      domain,
      articleCount,
      peopleCount: domainPeople[domain]?.size || 0,
      people: Array.from(domainPeople[domain]?.values() ?? []),
      url: domainMap[domain],
    }));

  console.log(sourceStats);

  return sourceStats;
});
