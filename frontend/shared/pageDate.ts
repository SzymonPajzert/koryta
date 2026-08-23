/** Reading a publication date out of a page's html.
 *
 * Shared because three things need the same answer and used to give three
 * different ones: `getPageMeta` (which an editor adding a url calls), the
 * extension's capture, and `scripts/migrate/backfill-article-dates.ts`. The
 * date matters more than it looks - /zrodla sorts on `publishedDate`, and a
 * Firestore `orderBy` drops the documents that lack the field entirely, so an
 * article we cannot date is not last in the list, it is absent from it.
 *
 * Regexes rather than a parser: this runs in a Cloud Function, in the Nuxt
 * server, and under `tsx` in a one-off script, and the shapes it looks for are
 * all machine-written. `cheerio` is a dependency of `functions/` alone.
 */

/** Nothing this site covers was published before the web, and a date in the
 * future is a template that rendered wrong. Either way it is worse than having
 * no date, so it is rejected rather than stored. */
const MIN_DATE = Date.UTC(1990, 0, 1);
const maxDate = () => Date.now() + 24 * 60 * 60 * 1000;

export function usableDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw.trim());
  const time = date.getTime();
  if (Number.isNaN(time) || time < MIN_DATE || time > maxDate())
    return undefined;
  return date;
}

/** The first string value stored under any of `keys`, however deeply nested.
 *
 * ld+json is shaped differently by every CMS - sometimes an object, sometimes
 * an `@graph` array, sometimes both - and the date is the only thing wanted out
 * of it.
 */
export function deepFind(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (keys.includes(key) && typeof val === "string" && val) return val;
    }
    for (const val of Object.values(value)) {
      const found = deepFind(val, keys);
      if (found) return found;
    }
  }
  return undefined;
}

const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];

/** Keys that carry a publication date inside a page's own json payload.
 *
 * `release_date_dt` is TVP's; the rest are what the common frameworks put in
 * `__NEXT_DATA__` and friends. Read last, because unlike ld+json this json is
 * not addressed to us and the same key may belong to a recommended article
 * further down the page - which still dates the row better than not listing it.
 */
const JSON_DATE_KEYS = [
  "release_date_dt",
  "datePublished",
  "publishedAt",
  "published_at",
  "publication_date",
  "first_published_at",
];

/** Reads a publication date out of a page's html, newest source of truth first.
 *
 * Every ld+json block is tried, not just the first: on the outlets that lead
 * with an `Organization` or `BreadcrumbList` block, the first one is the one
 * without a date, and taking `.first()` is how a good part of the archive
 * arrived dateless.
 *
 * Returns an ISO string, or `undefined` when the page says nothing usable.
 */
export function extractPublishedDate(html: string): string | undefined {
  const published: string[] = [];
  const modified: string[] = [];

  const ldJson = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of ldJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      continue; // A block we cannot read is not a reason to give up on the page.
    }
    const p = deepFind(parsed, ["datePublished", "dateCreated"]);
    if (p) published.push(p);
    const m = deepFind(parsed, ["dateModified"]);
    if (m) modified.push(m);
  }

  for (const match of html.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs = match[1]!;
    const name = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(
      attrs,
    )?.[1];
    const content = attr(attrs, "content");
    if (!name || !content) continue;
    const key = name.toLowerCase();
    if (
      key === "article:published_time" ||
      key === "og:article:published_time" ||
      key === "datepublished" ||
      key === "date" ||
      key === "dc.date.issued"
    ) {
      published.push(content);
    } else if (
      key === "article:modified_time" ||
      key === "og:updated_time" ||
      key === "datemodified"
    ) {
      modified.push(content);
    }
  }

  // <time datetime="…">, which is what a CMS that emits no ld+json and no
  // og tags still emits - wnp.pl marks it `itemprop="datePublished"`,
  // e-legnickie.pl marks it not at all.
  const times = [...html.matchAll(/<time\s+([^>]*?)\/?>/gi)]
    .map((match) => ({
      attrs: match[1]!,
      datetime: attr(match[1]!, "datetime"),
    }))
    .filter((time): time is { attrs: string; datetime: string } =>
      Boolean(time.datetime),
    );
  const labelOf = (attrs: string) =>
    `${attr(attrs, "itemprop") ?? ""} ${attr(attrs, "class") ?? ""} ${
      attr(attrs, "property") ?? ""
    }`.toLowerCase();
  const publishedTimes = times.filter(
    ({ attrs }) =>
      /\bpubdate\b/i.test(attrs) ||
      /publish|pubdat|entry-date|data-publikacji/.test(labelOf(attrs)),
  );
  if (publishedTimes.length > 0) {
    published.push(...publishedTimes.map((time) => time.datetime));
  } else if (times.length === 1) {
    // One `<time>` on the page is the page's own date. Several unmarked ones
    // are a list - a forum thread's posts, a sidebar of related pieces - and
    // there is no telling which is the article, so none of them is used.
    published.push(times[0]!.datetime);
  }
  modified.push(
    ...times
      .filter(({ attrs }) => /modif|updat|aktualiz/.test(labelOf(attrs)))
      .map((time) => time.datetime),
  );

  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1]!;
    for (const key of JSON_DATE_KEYS) {
      const found = new RegExp(
        `["']${key}["']\\s*:\\s*["']([^"']{4,40})["']`,
      ).exec(body)?.[1];
      if (found) published.push(found);
    }
  }

  // Publication before modification: a page edited years later still reports
  // the day it ran, and that is the date the list is sorted by.
  for (const candidate of [...published, ...modified]) {
    const date = usableDate(candidate);
    if (date) return date.toISOString();
  }
  return undefined;
}

/** The date some urls carry in the path.
 *
 * Only the two shapes that are unambiguous: a web.archive.org capture stamp,
 * and a blog's `/2024/09/04/` segments. Worth trying before anything that dates
 * an article by when we noticed it, because both state something about the
 * article itself - the archive stamp in particular is the one date a snapshot
 * of a homepage has.
 */
export function dateFromUrl(url: string): string | undefined {
  const archived = /\/web\/(\d{4})(\d{2})(\d{2})\d{6}(?:[a-z_]+)?\//i.exec(url);
  const path = /\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(url);
  const match = archived ?? path;
  if (!match) return undefined;
  return usableDate(
    `${match[1]}-${match[2]}-${match[3]}T00:00:00Z`,
  )?.toISOString();
}
