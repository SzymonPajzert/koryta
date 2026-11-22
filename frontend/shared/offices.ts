/** The urząd that runs a region: where a wójt, a burmistrz, a starosta or a
 * marszałek - and their deputies - are employed.
 *
 * None of these offices is in KRS, so the graph only has one where somebody
 * has added it by hand, and a contributor who knows that a person is "zastępca
 * prezydenta Wejherowa" has no company to pick. They do have the region. The
 * table behind this module says which office runs it and what its REGON is,
 * which is both what to call a new place for it and how to tell that the
 * place is already there.
 *
 * The table is the output of the `LocalGovernmentOffices` pipeline in
 * data/pipelines. It is kept on the region nodes rather than shipped with the
 * site (decision on 2026-11-22): each node carries, as `offices`, the urząd
 * that runs it (`officesFor`). Every gmina is a region of its own, so no region
 * answers for another's urząd: a powiat offers its starostwo, a gmina its urząd
 * (decision on 2026-11-22). `koryta_uploader --type region` sends the table to
 * /api/ingest/region, which gives each node its rows.
 */
import { normalizeNip, normalizeRegon } from "./identifiers";

/** One office, listed under one region it serves. */
export type RegionOffice = {
  /** The region's TERYT code, as its node carries it: two digits for a
   * województwo, four for a powiat, seven for a gmina. */
  teryt: string;
  /** TERC's name for the region, as TERC writes it: "Wejherowo",
   * "wejherowski", "POMORSKIE". */
  region: string | null;
  name: string;
  regon: string;
  /** Absent for the Warsaw dzielnice, whose urzędy are local units of the
   * city's and file no NIP of their own. */
  nip: string | null;
};

/** An office as the relation dialog offers it. */
export type RegionOfficeOption = RegionOffice & {
  /** The place already on the site under this REGON, when there is one - the
   * one to record the post against, rather than proposing a second copy. */
  node: { id: string; name: string } | null;
  /** The region a place proposed for the office is seated in: the region
   * asked about, or for a town's or the villages' half of a gmina the gmina
   * whose urząd it is. */
  seatId: string;
};

export type RegionOffices = { offices: RegionOfficeOption[] };

/** The rows a region node carries in its `offices` field. A row that lacks a
 * code, a name or a REGON is skipped rather than failing the rest: a region
 * with no office is a region the dialog cannot help with, which is what it was
 * before the table existed. Anything but a list is no rows. */
export function storedOffices(value: unknown): RegionOffice[] {
  if (!Array.isArray(value)) return [];
  const offices: RegionOffice[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<Record<keyof RegionOffice, unknown>>;
    if (!row.teryt || !row.name || !row.regon) continue;
    offices.push({
      teryt: String(row.teryt),
      region: row.region ? String(row.region) : null,
      name: String(row.name),
      regon: String(row.regon),
      nip: row.nip ? String(row.nip) : null,
    });
  }
  return offices;
}

export function indexOffices(
  offices: RegionOffice[],
): Map<string, RegionOffice[]> {
  const index = new Map<string, RegionOffice[]>();
  for (const office of offices) {
    const listed = index.get(office.teryt);
    if (listed) listed.push(office);
    else index.set(office.teryt, [office]);
  }
  return index;
}

/** TERYT's RODZ, the last digit of a gmina's code, for a gmina miejsko-wiejska. */
const RODZ_MIEJSKO_WIEJSKA = "3";

/** The urząd that runs a region: what its node carries, and what the relation
 * dialog offers for it. One for a gmina or a powiat, the marszałek's and the
 * wojewoda's for a województwo.
 *
 * TERYT splits a gmina miejsko-wiejska into a town and the villages around it
 * - Warka is 1406113, and 1406114 the town, 1406115 the rest - and the site
 * has nodes for some of those halves, since KRS names them as owners. Neither
 * has an urząd of its own: the gmina's runs both, so a half is answered with
 * the gmina's row, which shares all but its last digit. */
export function officesFor(
  index: Map<string, RegionOffice[]>,
  teryt: string,
): RegionOffice[] {
  const own = index.get(teryt);
  if (own) return own;
  if (/^\d{6}[45]$/.test(teryt)) {
    return index.get(`${teryt.slice(0, 6)}${RODZ_MIEJSKO_WIEJSKA}`) ?? [];
  }
  return [];
}

/** What to propose for an office the site has no place for yet, as
 * /api/revisions/create takes it.
 *
 * `isPublic` is said outright: an urząd is the public sector by definition,
 * and it is what makes the post count among a person's public posts. It is
 * also a claim nobody could otherwise make for it - the scrapers read
 * ownership from KRS, which an urząd is not in. */
export function officeProposal(office: RegionOffice) {
  return {
    type: "place" as const,
    name: office.name,
    regonNumber: normalizeRegon(office.regon),
    ...(office.nip ? { nipNumber: normalizeNip(office.nip) } : {}),
    isPublic: true,
  };
}

/** Whether a place is called an urząd or a starostwo outright, which is how
 * every office in the table is named - and how somebody adding one by hand
 * names it too.
 *
 * Read from the name because nothing else tells an urząd from a public company:
 * both are `place` nodes, public, and an urząd has no KRS entry to file it
 * under a sector. Whole words only, so a unit named after the urząd it serves -
 * „Centrum Usług Wspólnych Urzędu Miasta” - is not one. */
export function isOfficeName(name: string | undefined): boolean {
  return !!name && /(?<!\p{L})(urz[aą]d|starostwo)(?!\p{L})/iu.test(name);
}
