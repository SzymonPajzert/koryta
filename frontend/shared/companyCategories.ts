/** The sectors a company can be filed under, and what to call them.
 *
 * This is the list the category filter on /eksploruj offers and the edit form
 * puts in its dropdown. It is *only* the vocabulary: which companies belong to
 * which sector is decided by the pipelines, in
 * `data/pipelines/src/entities/company_categories.py`, and arrives on the node
 * through `/api/ingest/company`.
 *
 * The order matches `COMPANY_CATEGORIES` in the pipelines, because that is the
 * order a company's categories are stored in and the filter reads better when
 * the two agree.
 *
 * It used to be decided here, by matching PKD prefixes against the `activity`
 * codes in the ingest payload. That does not survive contact with the register:
 * KRS carries two vintages of PKD at once (the 2025 revision split passenger
 * rail out of 49.10 into 49.11 and 49.12), a code can be declared because a
 * quarry owns a siding, and the only code that reaches PKP PLK is also carried
 * by road builders - so the mapping needs a per-company override list with a
 * reason against each entry, which is pipeline work with tests against real
 * KRS numbers, not a frontend constant.
 *
 * `categories` is a node field like any other from here on: revisioned, shown
 * in the edit form, and once a person has set it, marked
 * `categoriesSource: "manual"` so the next ingest leaves it alone - the same
 * contract `isPublic` and `isPublicSource` already have.
 */

export const companyCategories = [
  { value: "szpitale", title: "Szpitale" },
  { value: "przychodnie", title: "Przychodnie i opieka ambulatoryjna" },
  { value: "wodociagi", title: "Wodociągi i kanalizacja" },
  { value: "cieplownictwo", title: "Ciepłownictwo" },
  { value: "energetyka", title: "Energetyka" },
  { value: "odpady", title: "Odpady i recykling" },
  { value: "koleje", title: "Koleje" },
  { value: "komunikacja-miejska", title: "Komunikacja miejska i autobusowa" },
  { value: "sport", title: "Sport i rekreacja" },
  { value: "obronnosc", title: "Obronność" },
  // Not a sector but an owner: the companies on Prokuratoria's list of the
  // Treasury's stakes (Szymon, 2026-10-28). Last, as the pipelines file it
  // after a company's sectors - see `isSector`.
  { value: "skarb-panstwa", title: "Skarb Państwa" },
] as const satisfies readonly { value: string; title: string }[];

export type CompanyCategory = (typeof companyCategories)[number]["value"];

/** The category values, as a tuple, for `z.enum` and for anything that has to
 * check a stored value is still one the site knows about. */
export const companyCategoryValues = companyCategories.map((c) => c.value) as [
  CompanyCategory,
  ...CompanyCategory[],
];

export function categoryTitle(value: string): string {
  return (
    companyCategories.find((c) => c.value === value)?.title ??
    /* A category the pipelines know about and this list does not yet: show the
     * stored value rather than an empty chip, so it is visible that something
     * needs adding here. */
    value
  );
}

/** Where to send a reader who clicks a category.
 *
 * A category is only useful as a way into the rest of the sector - somebody who
 * sees „Koleje” on PKP Intercity wants the other railways, not a label - so the
 * chip on a company page and the filter on /eksploruj have to agree on one
 * address. Kept here rather than built at each call site, because the query
 * parameter's name is the contract between them.
 */
export function categoryFilterUrl(value: string): string {
  return `/eksploruj/tabela?category=${encodeURIComponent(value)}`;
}

/** Whether every value is one the site offers.
 *
 * A stored set can contain a value this list has dropped - the pipelines and
 * the site deploy separately - so reading is tolerant. Writing is not: the edit
 * schema rejects anything off this list, or a typo in a proposal would create a
 * category nothing can ever filter on.
 */
export function isKnownCategory(value: string): value is CompanyCategory {
  return companyCategories.some((c) => c.value === value);
}

/** The categories that say who owns a company rather than what it does.
 * Filed beside a sector, not in place of one, so whatever counts companies by
 * sector leaves them out: the home page's „Branże” would otherwise draw
 * „Skarb Państwa” as a sector, and count a post at PGE under both. */
const OWNERS: readonly string[] = ["skarb-panstwa"];

/** Whether `value` is a sector the site offers, not an owner. */
export function isSector(value: string): value is CompanyCategory {
  return isKnownCategory(value) && !OWNERS.includes(value);
}
