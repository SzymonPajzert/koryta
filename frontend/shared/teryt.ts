/** Helpers for the TERYT codes carried by region nodes.
 *
 * The codes are hierarchical and identified by length: 2 digits is a
 * województwo, 4 a powiat, 7 a gmina. Region node ids are `teryt<code>`, so a
 * powiat's code always starts with its województwo's code.
 */

/** What a target list names a województwo by: `woj:14`. */
export const WOJEWODZTWO_MARKER = "woj:";

/** `ids`, and after them the województwo of every region among them as a
 * marker, `woj:14`, so that one array-contains finds the people of a
 * województwo where its 48-144 regions take several queries (decision on
 * 2026-11-23). The code comes off the id, so no lookup is needed: all 1,389
 * region nodes on the 2026-11-23 export follow the rule above. A marker rather
 * than the województwo's own node id, so that what counts the ids a node is
 * tied to (`hiddenTargets`) does not count it. */
export function withWojewodztwa(ids: string[]): string[] {
  const markers = new Set<string>();
  for (const id of ids) {
    const code = /^teryt(\d{2})/.exec(id)?.[1];
    if (code) markers.add(`${WOJEWODZTWO_MARKER}${code}`);
  }
  return markers.size === 0 ? ids : [...ids, ...markers];
}

/** A `withWojewodztwa` marker rather than a node id. */
export function isWojewodztwoMarker(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(WOJEWODZTWO_MARKER);
}

export function isWojewodztwoTeryt(teryt: string): boolean {
  return /^\d{2}$/.test(teryt);
}

/** The województwo a code belongs to, or null if it is not a TERYT code. */
export function wojewodztwoOf(teryt: string): string | null {
  return /^\d{2,}$/.test(teryt) ? teryt.slice(0, 2) : null;
}

/** Whether `teryt` is the given województwo or lies inside it. */
export function isInWojewodztwo(teryt: string, wojewodztwo: string): boolean {
  return wojewodztwoOf(teryt) === wojewodztwo;
}

/** Region names in the database are inconsistent for województwa - some carry
 * the "Województwo" prefix, some are the bare adjective. Normalizes them so the
 * filter list reads the same for all sixteen. */
export function wojewodztwoLabel(name: string): string {
  const bare = name.replace(/^Województwo\s+/i, "");
  return `Województwo ${bare.charAt(0).toLowerCase()}${bare.slice(1)}`;
}

/** Items for the region filter picker.
 *
 * The sixteen województwa come first - they cover a whole voivodeship, so they
 * are the coarse choice a user reaches for - followed by powiaty and gminy.
 * Regions with no TERYT code cannot be filtered on and are dropped.
 */
export function regionFilterOptions(
  regions: { name?: string; teryt?: string }[],
): { title: string; value: string }[] {
  const wojewodztwa: { title: string; value: string }[] = [];
  const rest: { title: string; value: string }[] = [];

  for (const region of regions) {
    if (!region.teryt || !region.name) continue;
    if (isWojewodztwoTeryt(region.teryt)) {
      wojewodztwa.push({
        title: wojewodztwoLabel(region.name),
        value: region.teryt,
      });
    } else {
      rest.push({ title: region.name, value: region.teryt });
    }
  }

  const byTitle = (a: { title: string }, b: { title: string }) =>
    a.title.localeCompare(b.title, "pl");
  return [...wojewodztwa.sort(byTitle), ...rest.sort(byTitle)];
}

/** The powiat a code belongs to, or null where it names something coarser.
 *
 * A gmina's code extends its powiat's, so the powiat is its first four digits -
 * the trailing digits say which gmina and of what kind, and the map has no
 * shape that fine anyway. Województwo codes have no powiat and give null.
 */
export function powiatOf(teryt: string): string | null {
  return /^\d{4,}$/.test(teryt) ? teryt.slice(0, 4) : null;
}

/** Whether a place named by `teryt` shows up in `powiat` on the map.
 *
 * The codes a place carries are of every size - a person stands for election in
 * a gmina, works for a spółka a województwo owns - while the map is drawn in
 * powiaty. A województwo therefore covers every powiat inside it, and a gmina
 * is drawn as the whole powiat around it: coarser than the truth, but the only
 * shape there is to colour.
 */
export function terytCoversPowiat(teryt: string, powiat: string): boolean {
  if (isWojewodztwoTeryt(teryt)) return isInWojewodztwo(powiat, teryt);
  return powiatOf(teryt) === powiat;
}
