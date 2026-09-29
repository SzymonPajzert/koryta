/** The same address with a scheme, for one that was pasted without one.
 *
 * `https`, because what this returns is *stored* - as `Article.sourceURL`, and
 * so as the `href` of every link to the piece. A bare `example.pl/a` in an
 * `href` is a relative path and resolves against koryta.pl. `normalizeUrl`
 * drops the scheme again before comparing, so which one is assumed here does
 * not change what matches what.
 */
export function withHttpScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** A url reduced to what identifies the page, for comparing two of them.
 *
 * The same article reaches the database written several ways: the crawler
 * stores `https://www.example.pl/a/`, while the extraction pipeline stores
 * `example.pl/a` with no scheme at all. Compared as strings those are three
 * different articles, which is why not one of the 269 extracted facts managed
 * to link itself to an article node.
 *
 * Mirrors `NormalizedParse.parse` in `data/pipelines/src/entities/util.py`, the
 * rule the scrapers already normalise by: supply the missing scheme, lowercase
 * the host, drop a leading `www.` and a trailing slash. The query string is
 * kept — for most Polish news sites it is tracking noise, but for some it is
 * the article id, and dropping it would merge different pages.
 *
 * The fragment goes, as it does from what the extension captures: it is never
 * sent to the server, so it points into a page rather than fetching another.
 * Only an app that routes on it (`#!/…`) shows a different page under one, and
 * no stored article is on such an app - in the 2026-09-29 export the nine
 * article urls with a fragment point at comments (`#komentarz`), at a quoted
 * passage (`#:~:text=`) or at tracking (`#s=S.embed_link-…`).
 */
export function normalizeUrl(url: string): string {
  const withScheme = withHttpScheme(url);

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    // Not a url at all; comparing it verbatim is the best that can be done.
    return url.trim().toLowerCase();
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/$/, "");
  return `${host}${path}${parsed.search}`;
}

/** `normalizeUrl`, with a numeric `page` parameter set aside.
 *
 * For a reading list to tell that two stored articles are one piece, which an
 * address alone cannot always say. On iswinoujscie.pl `?page=1` is the second
 * page of an article's comments, and a reader who cited a comment there filed
 * the article a second time, under that address. A numeric `page` pages
 * through one piece - its comments, or an article split in parts - wherever a
 * CMS uses the name, but a site may still number its pages that way, so this
 * is only half of the test: `/api/nodes/[id]/mentions` asks for the same title
 * too. Not a rule for matching an article when it is stored - that is
 * `normalizeUrl`'s, which the pipelines share.
 */
export function normalizeUrlIgnoringPage(url: string): string {
  const normalized = normalizeUrl(url);
  const start = normalized.indexOf("?");
  if (start < 0) return normalized;
  const kept = normalized
    .slice(start + 1)
    .split("&")
    .filter((part) => !/^page=\d+$/.test(part));
  const address = normalized.slice(0, start);
  return kept.length > 0 ? `${address}?${kept.join("&")}` : address;
}
