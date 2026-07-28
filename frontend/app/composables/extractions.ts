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

/** Extraction facts, newest first. Without `limit` the whole collection is
 * returned — the review flow needs every unreviewed fact, not a first page. */
export function useExtractions(options?: {
  tag?: string;
  groupBy?: "article";
  limit?: number;
}) {
  const query = computed(() => {
    const q: Record<string, string> = {};
    if (options?.tag) q.tag = options.tag;
    if (options?.groupBy) q.groupBy = options.groupBy;
    if (options?.limit !== undefined) q.limit = String(options.limit);
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
