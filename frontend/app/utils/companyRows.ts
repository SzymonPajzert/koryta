import { asArray, type Company } from "~~/shared/model";
import {
  companySortOptions,
  DEFAULT_COMPANY_SORT,
  type CompanySortKey,
} from "~~/shared/queryUrl";
import type { CompanyPeople } from "~~/server/api/stats/companies.get";
import type { PlaceRegion } from "~/utils/companyLocation";

/** One row of the companies view of /eksploruj/tabela.
 *
 * Everything in it is already on the page before the view is opened, bar the
 * counts: the place list feeds the „Instytucje” filter and the region list
 * feeds the seats, and both are fetched for the people table anyway. So the
 * view is filtered, sorted and paged here, in the browser, and costs the
 * database one cached response - /api/stats/companies - however the reader
 * narrows it.
 */
export type CompanyRow = {
  id: string;
  name: string;
  /** Unwrapped from the sanitized-array form a node may store them in. */
  categories: string[];
  /** Where the register seats it, as the region collection records it.
   * Absent for an institution no region claims - 187 of ~5,100 on the
   * 2026-09-29 export. */
  seat?: PlaceRegion;
  isPublic?: boolean;
  isPublicSource?: "manual";
  /** Whether the institution's own page is published. Only a signed-in reader
   * is ever handed a draft, and the table marks it for them. */
  visibility?: boolean;
  /** From /api/stats/companies; zero for an institution it does not list. */
  people: number;
  current: number;
  latestStart?: string;
};

export type CompanyFilters = {
  category?: string | null;
  /** Region codes the seat has to lie in - `teryt` and `companyTeryt`, which
   * for a company both mean its seat. Every one of them has to hold, the way
   * two filters narrow the people table. */
  regions?: (string | null | undefined)[];
  /** Institutions picked by node id, from the „Instytucje” filter. */
  places?: string[] | null;
};

/** Whether a seat lies inside a region, by TERYT code.
 *
 * A code extends the code of every region around it - województwo, then powiat,
 * then gmina - so inside is a prefix: a company seated in powiat 1261 is in
 * województwo 12 and in 1261 itself, and in no gmina, since the register put
 * it at the powiat. Nearly every seat is a powiat (4,850 of the 4,899 on the
 * 2026-09-29 export that have one), which is what a województwo filter has to
 * reach down to. */
export function seatIsIn(seat: string | undefined, region: string): boolean {
  return !!seat && !!region && seat.startsWith(region);
}

/** The institutions the filters leave, as rows, in no particular order.
 *
 * `places` is whatever the page holds - for a guest already stripped of the
 * unpublished ones by `useEntitiesFiltering`, for an editor with them in.
 * `people` is undefined until its response arrives; the rows are built anyway,
 * at zero, so the table can be drawn and the counts fill in. */
export function companyRows(
  places: Record<string, Company & { visibility?: boolean }>,
  seats: Record<string, PlaceRegion>,
  people: Record<string, CompanyPeople> | undefined,
  filters: CompanyFilters = {},
): CompanyRow[] {
  const regions = (filters.regions ?? []).filter(
    (region): region is string => !!region,
  );
  const picked =
    filters.places && filters.places.length > 0
      ? new Set(filters.places)
      : undefined;

  const rows: CompanyRow[] = [];
  for (const [id, place] of Object.entries(places)) {
    // A merged-away institution keeps its document so its url resolves, and
    // /api/nodes leaves it out of the list already. This is the same rule
    // again for anything that reaches here some other way.
    if ((place as { deleted?: unknown }).deleted === true) continue;
    if (picked && !picked.has(id)) continue;

    const categories = asArray<string>(place.categories);
    if (filters.category && !categories.includes(filters.category)) continue;

    const seat = seats[id];
    if (regions.some((region) => !seatIsIn(seat?.teryt, region))) continue;

    const counted = people?.[id];
    rows.push({
      id,
      name: place.name,
      categories,
      seat,
      isPublic: place.isPublic,
      isPublicSource: place.isPublicSource,
      visibility: place.visibility,
      people: counted?.people ?? 0,
      current: counted?.current ?? 0,
      latestStart: counted?.latestStart,
    });
  }
  return rows;
}

/** A name as it sorts: without the quotation marks, dashes and digits some of
 * them open on, so „Wodociągi Kraków” files under W rather than before A. */
function sortName(name: string): string {
  return name.replace(/^[^\p{L}]+/u, "");
}

const byName = (a: CompanyRow, b: CompanyRow) =>
  sortName(a.name).localeCompare(sortName(b.name), "pl", {
    sensitivity: "base",
  });

type SortEntry = { key: string; order: "asc" | "desc" };

/** Whether `key` is one the companies view can sort by. */
export function isCompanySortKey(
  key: string | undefined,
): key is CompanySortKey {
  return companySortOptions.some((option) => option.key === key);
}

/** The sort in force: the one the url asks for, if the companies view knows it,
 * else `DEFAULT_COMPANY_SORT`. A key it does not know is one carried over from
 * the people table by hand - the switch drops the sort - and ordering by it
 * would be ordering by nothing. */
export function companySort(sort: SortEntry | undefined): {
  key: CompanySortKey;
  order: "asc" | "desc";
} {
  return sort && isCompanySortKey(sort.key)
    ? { key: sort.key, order: sort.order }
    : { ...DEFAULT_COMPANY_SORT };
}

/** The rows in the order the reader asked for.
 *
 * Ties are broken by name, A to Z, whichever way the main key runs, so a page
 * of institutions with one person apiece is read alphabetically rather than in
 * whatever order the place list arrived. A missing date sorts last in both
 * directions: it is not the oldest employment, it is none on record.
 */
export function sortCompanyRows(
  rows: CompanyRow[],
  requested: SortEntry | undefined,
): CompanyRow[] {
  const { key, order } = companySort(requested);
  const sign = order === "desc" ? -1 : 1;

  const compare = (a: CompanyRow, b: CompanyRow): number => {
    switch (key) {
      case "name":
        return sign * byName(a, b);
      case "people":
        return (
          sign * (a.people - b.people) ||
          sign * (a.current - b.current) ||
          byName(a, b)
        );
      case "current":
        return (
          sign * (a.current - b.current) ||
          sign * (a.people - b.people) ||
          byName(a, b)
        );
      case "latestStart": {
        if (a.latestStart === b.latestStart) return byName(a, b);
        if (!a.latestStart) return 1;
        if (!b.latestStart) return -1;
        return sign * a.latestStart.localeCompare(b.latestStart);
      }
    }
  };

  return [...rows].sort(compare);
}

/** One page of rows, the way `v-data-table-server` numbers them: from 1. */
export function companyPage(
  rows: CompanyRow[],
  page: number,
  perPage: number,
): CompanyRow[] {
  const start = (Math.max(page, 1) - 1) * perPage;
  return rows.slice(start, start + perPage);
}
