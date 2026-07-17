import type { ExtractionFact } from "~~/shared/model";
import { authFetch } from "~/composables/auth";

type GroupedArticle = {
  domain: string;
  facts: ExtractionFact[];
};

type ExtractionsResponse = {
  facts?: ExtractionFact[];
  articles?: Record<string, GroupedArticle>;
};

export function useExtractions(options?: {
  tag?: string;
  groupBy?: "article";
}) {
  const query = computed(() => {
    const q: Record<string, string> = {};
    if (options?.tag) q.tag = options.tag;
    if (options?.groupBy) q.groupBy = options.groupBy;
    return q;
  });

  const { data, pending, error, refresh } = authFetch<ExtractionsResponse>(
    "/api/extractions",
    {
      query,
    },
  );

  return { data, pending, error, refresh };
}
