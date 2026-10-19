import type { MaybeRefOrGetter } from "vue";
import type { ExtractionFact } from "~~/shared/model";
import { authFetch } from "~/composables/auth";

type GroupedArticle = {
  domain: string;
  facts: ExtractionFact[];
};

type ExtractionsResponse = {
  facts?: ExtractionFact[];
  articles?: Record<string, GroupedArticle>;
  /** Facts matching the filters with the page ignored — how many there are,
   * not how many were returned. */
  total: number;
};

/** Extraction facts, newest first. The API always serves a page, so `total` is
 * what says how much backlog sits behind it; pass `page` as a ref to walk on.
 */
export function useExtractions(options?: {
  tag?: MaybeRefOrGetter<string | undefined>;
  /** Everything from one article, by the url the uploader recorded. */
  articleUrl?: MaybeRefOrGetter<string | undefined>;
  /** Everything matched to one person, by their node id. */
  personNodeId?: MaybeRefOrGetter<string | undefined>;
  /** How many match, without fetching any of them. */
  countOnly?: MaybeRefOrGetter<boolean | undefined>;
  groupBy?: "article";
  reviewed?: MaybeRefOrGetter<"all" | "yes" | "no">;
  limit?: MaybeRefOrGetter<number | undefined>;
  page?: MaybeRefOrGetter<number | undefined>;
  /** Fetch in the server render too (the default). Pass `false` where only a
   * signed-in reader is shown the facts: the server render has no token to
   * send, so its answer holds none of them, and hydration then keeps that
   * answer instead of asking again with the token. */
  server?: boolean;
}) {
  const query = computed(() => {
    const q: Record<string, string> = {};
    const tag = toValue(options?.tag);
    const articleUrl = toValue(options?.articleUrl);
    const personNodeId = toValue(options?.personNodeId);
    const countOnly = toValue(options?.countOnly);
    const reviewed = toValue(options?.reviewed);
    const limit = toValue(options?.limit);
    const page = toValue(options?.page);
    if (tag) q.tag = tag;
    if (articleUrl) q.articleUrl = articleUrl;
    if (personNodeId) q.personNodeId = personNodeId;
    if (countOnly) q.countOnly = "true";
    if (options?.groupBy) q.groupBy = options.groupBy;
    if (reviewed) q.reviewed = reviewed;
    if (limit !== undefined) q.limit = String(limit);
    if (page !== undefined) q.page = String(page);
    return q;
  });

  const { data, pending, error, refresh } = authFetch<ExtractionsResponse>(
    "/api/extractions",
    {
      query,
      server: options?.server ?? true,
    },
  );

  return { data, pending, error, refresh };
}

/** One fact by id, whatever its review state — how a shared `?fact=` link
 * reaches a card the filtered list would not hand back. The id is read once,
 * so pass a plain string; a null one fetches nothing. */
export function useExtraction(id: string | null) {
  const { data, error } = authFetch<{ fact: ExtractionFact }>(
    () => (id ? `/api/extractions/${encodeURIComponent(id)}` : ""),
    {
      immediate: !!id,
      // In the browser only. The endpoint refuses a caller with no token, and
      // the server render has none to send, so it only ever stored a 401 -
      // which hydration kept, and a link opened by somebody already signed in
      // fell through to the queue's next card.
      server: false,
    },
  );

  const fact = computed<ExtractionFact | null>(() => data.value?.fact ?? null);
  // Nothing to wait for when there is no link, and a missing fact (404) is an
  // answer too: the flow falls back to the next unreviewed card.
  const settled = computed(() => !id || !!fact.value || !!error.value);

  return { fact, settled, error };
}
