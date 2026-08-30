import { authRequest } from "~/composables/auth";
import { getPageMeta } from "~/composables/useFunctions";

/** What we store about an article, as `/api/ingest/article` takes it. */
export type ArticlePayload = {
  url: string;
  /** The page's own headline, where it gave us one. */
  name?: string;
  publishedDate?: string;
  meta?: unknown;
  /** Nodes this article names, recorded in the same commit as the article.
   *
   * Filing a url under somebody's note is a claim that the page is about them,
   * and it is the only moment at which anybody says so - so the mention is
   * written with the article rather than left for a reader to add by hand on a
   * page they have no reason to visit. */
  mentions?: string[];
};

type NestedRecord = {
  [key: string]: string | NestedRecord;
};

/** The first string stored under `key` anywhere in `obj`.
 *
 * Publishers nest their ld+json differently - a bare object, a `@graph`, an
 * array of both - and the date is what we are after however it is wrapped.
 */
function deepSearch(
  obj: NestedRecord | string | undefined | null,
  key: string,
): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;

  const val = obj[key];
  if (typeof val === "string") {
    return val;
  }

  for (const k in obj) {
    const result = deepSearch(obj[k], key);
    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}

/** Everything a url can tell us about itself, by fetching the page.
 *
 * `name` is absent where the fetch failed or the page has no title - a
 * paywall, a dead link, a PDF. The caller decides what that is worth: adding an
 * article by hand refuses it and says so, promoting a note's source falls back
 * to the url, since the source is worth keeping either way.
 *
 * The url comes back too, because ld+json often names a canonical address that
 * differs from the one that was pasted.
 */
export async function articlePayloadFor(url: string): Promise<ArticlePayload> {
  const meta = await getPageMeta(url);
  if (!meta) return { url };

  return {
    url: meta.url || url,
    name: meta.title || undefined,
    publishedDate:
      meta.meta?.ldJson?.datePublished ||
      meta.meta?.ldJson?.dateModified ||
      deepSearch(meta.meta as NestedRecord | undefined, "datePublished") ||
      deepSearch(meta.meta as NestedRecord | undefined, "dateModified"),
    meta: meta.meta,
  };
}

/** The article node for a url, created if this is the first time we see it.
 *
 * Which of the two happened is `created`; the endpoint matches urls normalized,
 * so the same piece added twice under different spellings is one node.
 * `mentions` names the nodes it says the article is about, and comes back as
 * the ones a relation was actually written for - an id already joined to the
 * article, or one that is not a person or a company, is left out.
 */
export async function ensureArticle(
  payload: ArticlePayload & { name: string },
): Promise<{ nodeId: string; created: boolean; mentions: string[] }> {
  return await authRequest<{
    nodeId: string;
    created: boolean;
    mentions: string[];
  }>("/api/ingest/article", { method: "POST", body: payload });
}
