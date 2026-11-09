import { withHttpScheme } from "./url";

/** Titles for the article pages that reached us without one of their own.
 *
 * An article is named after the page it stores, and that name is its `<title>`,
 * its heading, its slug and its row in every list. Where `getPageMeta` could not
 * read a title - a PDF, a page behind a sign-in wall, one that did not answer -
 * the article used to be named after its address instead. On 2026-11-09, 167 of
 * the 908 article nodes were, and Google showed them with
 * "https://bip.karczew.pl/fls/bip_pliki/2024_10/BIPF6237D18C822F5Z/Roslonek_Tomasz_zanonimi.pdf"
 * for a headline. 161 of the 167 came from a source somebody filed in a note
 * (app/components/note/Editor.vue), which fell back to the url.
 *
 * What such a page is about is still known: the note it was filed in hangs off
 * a person or a company, and the address names the site. So the fallback says
 * that - "Tomasz Rosłonek: dokument z bip.karczew.pl" - rather than repeating
 * the address. Only names of pages anyone can open go into it: an article page
 * is public, and a title is no place to name somebody whose own page is still a
 * draft. With nobody to name it says only where the page is from.
 */

/** Whether `name` is an address rather than a title. A real title does not
 * start with a scheme, and every url-named article in the database does - bar
 * the two typed by hand, which start with `www.`. */
export function isUrlShapedName(name: string | null | undefined): boolean {
  return !!name && /^\s*(?:https?:\/\/|www\.)/i.test(name);
}

/** The site an address is on, as a reader would say it: without `www.`. */
export function sourceHost(url: string): string | undefined {
  try {
    const host = new URL(withHttpScheme(url.trim())).hostname.toLowerCase();
    return host.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/** Whether an address is a file to download rather than a page to read, from
 * its extension. A fetch that saw the `Content-Type` knows better, and says so
 * with `document` in `composedArticleTitle`. */
export function isDocumentUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(withHttpScheme(url.trim())).pathname;
  } catch {
    return false;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // A stray `%` - the extension reads the same either way.
  }
  return /\.(?:pdf|docx?|odt|rtf|xlsx?|ods)$/i.test(path);
}

/** Up to two names as a phrase, and "i in." for the rest: a title naming five
 * people is a list, and the page itself shows all of them. */
function namesPhrase(names: readonly string[]): string {
  const unique = Array.from(
    new Set(names.map((name) => name.trim()).filter(Boolean)),
  );
  if (unique.length <= 2) return unique.join(" i ");
  return `${unique.slice(0, 2).join(", ")} i in.`;
}

/** The title an article gets when its page gave none.
 *
 * `names` are the people and companies it is filed under, public pages only -
 * see the module comment. `document` says whether the address is a file (a
 * PDF, a scan) rather than a page; left out, the extension decides. */
export function composedArticleTitle({
  url,
  names = [],
  document,
}: {
  url: string;
  names?: readonly string[];
  document?: boolean;
}): string {
  const what = (document ?? isDocumentUrl(url)) ? "dokument" : "strona";
  const host = sourceHost(url);
  const where = host ? `${what} z ${host}` : what;
  const who = namesPhrase(names);
  if (who) return `${who}: ${where}`;
  return where.charAt(0).toUpperCase() + where.slice(1);
}
