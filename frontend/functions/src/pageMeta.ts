import * as cheerio from "cheerio";
import { decodePage, type PageEncodingSource } from "../../shared/pageEncoding";

export type PageRead = {
  /** The page's `<title>`, trimmed - empty where it has none. */
  title: string;
  /** The first ld+json block, as the page wrote it; not parsed yet. */
  ldJson?: string;
  /** The encoding the page was read in, and what said so. */
  encoding: string;
  encodingSource: PageEncodingSource;
};

/** What `getPageMeta` takes off a fetched page, from its bytes.
 *
 * Decoded before cheerio sees it, in the charset the page declares or the one
 * its bytes are in - see `shared/pageEncoding.ts` for why that is not simply
 * UTF-8.
 *
 * A module of its own, apart from the function and the firebase-functions
 * runtime, so that `scripts/migrate/refetch-garbled-article-titles.ts` can
 * read a title exactly the way a newly added article gets one.
 */
export function readPage(
  body: Uint8Array,
  contentType: string | undefined,
): PageRead {
  const { text, encoding, source } = decodePage(body, contentType);
  const $ = cheerio.load(text);
  const ldJson = $('script[type="application/ld+json"]').first().html();
  return {
    title: $("title").first().text().trim(),
    ...(ldJson ? { ldJson } : {}),
    encoding,
    encodingSource: source,
  };
}
