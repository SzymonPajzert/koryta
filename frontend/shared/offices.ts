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
 * The table is `server/assets/local_government_offices.jsonl`, the output of
 * the `LocalGovernmentOffices` pipeline in data/pipelines, copied verbatim:
 * rerun that pipeline and copy the file over to refresh it.
 */
import { normalizeNip, normalizeRegon } from "./identifiers";

/** One office, listed under one region it serves. */
export type RegionOffice = {
  /** The region's TERYT code, as its node carries it: two digits for a
   * województwo, four for a powiat, seven for a gmina. */
  teryt: string;
  /** TERC's name for the region, as TERC writes it: "Wejherowo",
   * "wejherowski", "POMORSKIE". The only name there is for a gmina the site
   * has no region node for, which is most of them. */
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
  /** Which gmina's urząd it is, where it is offered as one of the gminy of
   * the powiat asked about - "Gmina wiejska Wejherowo" - and null for the
   * region's own office. See `officeChoices`. */
  gmina: string | null;
  /** The region a place proposed for the office is seated in: the office's
   * own region where the site has a node for it, and otherwise the region
   * asked about, which is at least the powiat around it. */
  seatId: string;
};

export type RegionOffices = { offices: RegionOfficeOption[] };

/** The rows of the table, one JSON object a line. A line that does not parse,
 * or lacks a code, a name or a REGON, is skipped rather than failing the rest:
 * a region with no office is a region the dialog cannot help with, which is
 * what it was before the table existed. */
export function parseOffices(text: string): RegionOffice[] {
  const offices: RegionOffice[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<RegionOffice>;
      if (!row.teryt || !row.name || !row.regon) continue;
      offices.push({
        teryt: String(row.teryt),
        region: row.region ? String(row.region) : null,
        name: String(row.name),
        regon: String(row.regon),
        nip: row.nip ? String(row.nip) : null,
      });
    } catch {
      continue;
    }
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

/** TERYT's RODZ, the last digit of a gmina's code, for the kinds of gmina the
 * table lists - and what the dialog calls each. */
const RODZ_MIEJSKO_WIEJSKA = "3";
const GMINA_KINDS: Record<string, string> = {
  "1": "Gmina miejska",
  "2": "Gmina wiejska",
  [RODZ_MIEJSKO_WIEJSKA]: "Gmina miejsko-wiejska",
  "8": "Dzielnica",
};

/** The offices listed under a region's code - one for a gmina or a powiat,
 * the marszałek's and the wojewoda's for a województwo.
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

/** Which gmina an office is listed for, the way the dialog tells a powiat's
 * gminy apart: "Gmina wiejska Wejherowo" beside "Gmina miejska Wejherowo".
 *
 * With the kind, since the town and the villages around it are often two
 * gminy of one name and one powiat, each with its own urząd - which is also
 * why the name alone would not do. */
export function gminaLabel(office: RegionOffice): string {
  const kind = GMINA_KINDS[office.teryt.slice(6)] ?? "Gmina";
  return office.region ? `${kind} ${office.region}` : kind;
}

/** The urzędy of the gminy inside a powiat - and in Warsaw of its dzielnice -
 * in the order of their gmina's name. Nothing for a code that is not a
 * powiat's. */
export function gminaOfficesIn(
  index: Map<string, RegionOffice[]>,
  powiat: string,
): RegionOffice[] {
  if (!/^\d{4}$/.test(powiat)) return [];
  const found: RegionOffice[] = [];
  for (const [teryt, offices] of index) {
    if (teryt.length === 7 && teryt.startsWith(powiat)) found.push(...offices);
  }
  return found.sort(
    (a, b) =>
      (a.region ?? "").localeCompare(b.region ?? "", "pl") ||
      a.teryt.localeCompare(b.teryt),
  );
}

/** What the relation dialog offers for a region: its own offices, and for a
 * powiat the urzędy of every gmina in it after them, each office once.
 *
 * The gminy are there because the site has a region node for only some of
 * them - those KRS names as the owner of a company - so for most a contributor
 * cannot pick the gmina itself, and the powiat's own office, the starostwo, is
 * not where a wójt or a burmistrz works. The powiat is always there to pick.
 * A województwo does not list its gminy: seventy to three hundred is not a
 * list anybody picks from, and every one of them is in some powiat.
 *
 * Once, because a city that is its own powiat has its urząd listed under both
 * codes. */
export function officeChoices(
  index: Map<string, RegionOffice[]>,
  teryt: string,
): { office: RegionOffice; gmina: string | null }[] {
  const own = officesFor(index, teryt);
  const seen = new Set(own.map((office) => office.regon));
  const gminy = gminaOfficesIn(index, teryt).filter((office) => {
    if (seen.has(office.regon)) return false;
    seen.add(office.regon);
    return true;
  });
  return [
    ...own.map((office) => ({ office, gmina: null })),
    ...gminy.map((office) => ({ office, gmina: gminaLabel(office) })),
  ];
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
