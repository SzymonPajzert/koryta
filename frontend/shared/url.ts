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
