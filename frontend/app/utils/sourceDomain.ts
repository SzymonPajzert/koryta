/** What a source is called, when it has to fit on one line of a card.
 *
 * A cited url is routinely 120 characters of path and tracking parameters, and
 * printing it whole is what made a note card cut its own source off mid-path
 * on a phone. The host is the part a reader recognises - "wyborcza.pl" says
 * more about a claim than the article slug does - and the whole address stays
 * one hover (or one click) away as the link's `href` and `title`.
 *
 * A scheme is added rather than required: `new URL` rejects "wyborcza.pl/x"
 * outright, and refusing to name the commonest way of typing an address by
 * hand would put the raw string back on the card.
 *
 * `null` for anything that is not an address at all - readers do paste
 * "gazeta, strona 3" into the url field, and a caller has to be free to render
 * that as text rather than as a link that opens a relative path on koryta.pl.
 * The public note card and the admin triage queue each held their own copy of
 * this, disagreeing about that last case; they now share this one.
 */
export function sourceDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    // A host is what makes this worth showing. "https://" alone parses, and a
    // hostname-less url would render as an empty label on an empty link.
    return parsed.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
