import type { NoteSource } from "~~/shared/model";
import { noteKindOf } from "~~/shared/model";
import { normalizeUrl } from "~~/shared/url";

/** The entries of a note that should become articles.
 *
 * A source entry is somebody saying "this is worth reading", which is what an
 * article node is for - so it is promoted, and only it: a correction or a gap
 * report may cite a url, but it cites it as evidence for a change, and filing
 * those as sources would fill the article list with pages nobody called
 * sources. An entry already promoted carries the node it became and is left
 * alone, which is what keeps a note that is saved twice from asking again.
 */
export function sourcesToPromote(sources: NoteSource[]): NoteSource[] {
  return sources.filter(
    (source) =>
      noteKindOf(source) === "source" &&
      !!source.url?.trim() &&
      !source.articleNodeId,
  );
}

/** The same entries, each pointed at the article node its url became.
 *
 * `articleIds` is keyed by `normalizeUrl`, not by the url as typed: the server
 * matches an existing article normalized, so two entries citing
 * `https://www.example.pl/a/` and `example.pl/a` are one article and both have
 * to be given its id. Keying by the raw string left the second entry
 * unattached, and the next save promoted it again.
 *
 * Returns null where nothing changed, so a save that promoted nothing does not
 * write the note again. Entries are matched by url rather than by position: the
 * promotion runs after the note is stored, and the author may have added
 * another entry in the meantime.
 */
export function withArticleIds(
  sources: NoteSource[],
  articleIds: Map<string, string>,
): NoteSource[] | null {
  const updated = sources.map((source) => {
    const url = source.url?.trim();
    const articleNodeId = url ? articleIds.get(normalizeUrl(url)) : undefined;
    if (!articleNodeId || source.articleNodeId === articleNodeId) return source;
    return { ...source, articleNodeId };
  });

  // An entry nothing was attached to is handed back as the very same object.
  const changed = updated.some((source, index) => source !== sources[index]);
  return changed ? updated : null;
}

/** The article node id for every page a note's un-promoted sources cite.
 *
 * Keyed by `normalizeUrl`, which is what `withArticleIds` looks entries up by.
 * `articleIdFor` is what does the storing - injected so that the rule of which
 * entries are promoted can be tested without the network. A url that fails is
 * simply absent from the map rather than retried here: the entry keeps no node
 * id, so the next save of the note tries it again.
 *
 * One request per *page*, not per entry: the urls are collapsed first, so a
 * note citing the same piece twice under two spellings does not race itself
 * into creating two article nodes for it. The url handed to `articleIdFor` is
 * still the one the author typed, because that is the address it is stored
 * under.
 */
export async function articleIdsForSources(
  sources: NoteSource[],
  articleIdFor: (url: string) => Promise<string | undefined>,
): Promise<Map<string, string>> {
  const articleIds = new Map<string, string>();
  const pending = sourcesToPromote(sources);
  if (pending.length === 0) return articleIds;

  const byPage = new Map<string, string>();
  for (const source of pending) {
    const url = source.url!.trim();
    const key = normalizeUrl(url);
    if (!byPage.has(key)) byPage.set(key, url);
  }

  await Promise.all(
    Array.from(byPage, async ([key, url]) => {
      try {
        const nodeId = await articleIdFor(url);
        if (nodeId) articleIds.set(key, nodeId);
      } catch (error) {
        console.error(`Failed to promote ${url} to an article`, error);
      }
    }),
  );

  return articleIds;
}
