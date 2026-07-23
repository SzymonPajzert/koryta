/** Company categories derived from KRS PKD activity codes.
 *
 * The scrapers send the raw PKD codes (e.g. "86.10.Z") in the company ingest
 * payload; the ingest endpoint maps them to categories with
 * `categoriesFromActivity` and stores both on the place node, so the
 * category filter does not need to know about PKD at query time.
 *
 * Note: companies in the associations register (e.g. SPZOZ hospitals) have no
 * PKD codes in KRS, so they cannot be categorized this way yet.
 */

export type CompanyCategory = "szpitale" | "wodociagi";

export const companyCategories: {
  value: CompanyCategory;
  title: string;
  pkdPrefixes: string[];
}[] = [
  {
    value: "szpitale",
    title: "Szpitale",
    // 86.10 Działalność szpitali
    pkdPrefixes: ["86.10"],
  },
  {
    value: "wodociagi",
    title: "Wodociągi i kanalizacja",
    // 36.00 Pobór, uzdatnianie i dostarczanie wody
    // 37.00 Odprowadzanie i oczyszczanie ścieków
    pkdPrefixes: ["36.00", "37.00"],
  },
];

export function categoryTitle(value: string): string {
  return companyCategories.find((c) => c.value === value)?.title ?? value;
}

export function categoriesFromActivity(
  activity: string[] | undefined,
): CompanyCategory[] {
  if (!activity || activity.length === 0) return [];
  return companyCategories
    .filter((category) =>
      activity.some((code) =>
        category.pkdPrefixes.some((prefix) => code.startsWith(prefix)),
      ),
    )
    .map((category) => category.value);
}
