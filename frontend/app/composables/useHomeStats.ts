import { computed } from "vue";
import type { Article } from "~~/shared/model";

export type SourceStat = {
  domain: string;
  articleCount: number;
  peopleCount: number;
  url: string | undefined;
};

export const useHomeStats = () => {
  const { entities: articles } = useEntity("article");

  const sourceStats = computed<SourceStat[]>(() => {
    const counts: Record<string, number> = {};
    const domainMap: Record<string, string> = {}; // domain -> full url sample

    Object.values(articles.value || {}).forEach((article: Article) => {
      if (!article.sourceURL) return;
      const url = new URL(article.sourceURL);
      const domain = url.hostname.replace("www.", "");
      counts[domain] = (counts[domain] || 0) + 1;
      if (!domainMap[domain]) domainMap[domain] = url.origin;
    });

    // Convert to array and sort
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1]) // Sort desc
      .map(([domain, articleCount]) => ({
        domain,
        articleCount,
        peopleCount: 0, // Placeholder, can be calculated similarly if needed
        url: domainMap[domain],
      }));
  });

  return {
    sourceStats,
  };
};
