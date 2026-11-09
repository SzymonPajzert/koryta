import { mangledIdKey, parseEntityUrlSlug } from "~~/shared/slugs";
import { SITEMAP_NODE_TYPES } from "~~/shared/lastmod";

/** The address of the public page an id names, matched without regard to the
 * id's case or to punctuation trailing it - see `mangledIdKey`.
 *
 * `[seoType]/[slug].vue` asks this once an id has failed to resolve as it is,
 * and sends the reader on to the answer.
 *
 * Read off the sitemap's list rather than out of Firestore, because no query
 * can compare ids without their case - and because the sitemap is the set worth
 * searching anyway: a mangled link should lead to a page anybody may read, at
 * the address that page is published under, and that is exactly what the list
 * holds. It is cached for six hours, so a lookup is one pass over it. The
 * sitemap reads it one page type at a time, so this asks for each type with a
 * page; the blog's posts have no id to match.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id", { decode: true });
  const key = id ? mangledIdKey(id) : "";
  if (!key) {
    throw createError({ statusCode: 400, message: "Missing id" });
  }

  const pages = (
    await Promise.all(
      SITEMAP_NODE_TYPES.map((type) =>
        event.$fetch<{ loc: string }[]>(`/api/_sitemap-urls/${type}`),
      ),
    )
  ).flat();
  const matches = pages.filter(
    ({ loc }) => mangledIdKey(parseEntityUrlSlug(loc).id) === key,
  );
  // Two pages whose ids differ only in case would make any answer a guess.
  if (matches.length !== 1) {
    throw createError({
      statusCode: 404,
      message: `No public page for id=${id}`,
    });
  }

  return { url: matches[0]!.loc };
});
