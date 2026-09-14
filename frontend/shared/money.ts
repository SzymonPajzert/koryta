/** Money, in złoty, for a reader rather than for an accountant.
 *
 * Nothing in the app formatted a currency before public contracts arrived - a
 * repo-wide search for `style: "currency"`, `PLN` and `zł` found no formatter
 * at all - so this is the first and, like `shared/dates.ts`, meant to be the
 * only one. The two functions below are not interchangeable: `plnExact` is
 * what a record says, `plnCompact` is what a heading says, and printing the
 * wrong one is how a page ends up with „12 325 630 169,00 zł" as a headline or
 * „1,4 tys. zł" on a contract whose value is the point.
 *
 * Two things `Intl` will not do on its own, both of them Polish-specific:
 *
 * - **Grouping.** CLDR's Polish locale starts grouping at five digits, so
 *   `style: "currency"` renders 6300 as „6300,00 zł" and only 38490 as
 *   „38 490,00 zł". `app/composables/polish.ts` has the same note about counts.
 *   Every figure here is grouped from four digits up, so two contract values in
 *   one list are comparable at a glance.
 * - **Not rounding across a magnitude.** `notation: "compact"` turns 9 999 into
 *   „10 tys.", which reads as more money than the contract was worth. The
 *   compact form therefore only starts at a full 10 000.
 */

/** A non-breaking space, so a figure never wraps between the number and „zł"
 * and thousands never wrap apart. `Intl` already emits one inside the number;
 * this is for the unit we add ourselves. */
const NBSP = " ";

const GROUPED = new Intl.NumberFormat("pl-PL", {
  useGrouping: true,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GROUPED_GROSZE = new Intl.NumberFormat("pl-PL", {
  useGrouping: true,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat("pl-PL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Below this a figure is printed in full; at or above it, compacted. Chosen
 * rather than inherited from `Intl`, which would compact 9 999 upwards into a
 * number that is not true. */
const COMPACT_FROM = 10_000;

/** What we print where we have no figure at all. The em dash is what
 * `chartTheme.formatCount` already uses for the same case. */
const NOTHING = "—";

function isNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/**
 * „1 436,50 zł", „120 zł", „1 105 491 462 zł".
 *
 * The grosze appear only when there are any. Two thirds of the register's
 * values are round złoty, and „,00" on every one of them is noise in a column
 * a reader is scanning for magnitude - but dropping them from 1 436,50 would
 * misstate a contract, so the decision is per figure and not per column.
 */
export function plnExact(value: number | null | undefined): string {
  if (!isNumber(value)) return NOTHING;
  const grosze = Math.round(value * 100) % 100 !== 0;
  const digits = grosze ? GROUPED_GROSZE : GROUPED;
  return `${digits.format(value)}${NBSP}zł`;
}

/**
 * „12,3 mld zł", „46,9 mln zł", „38 490 zł".
 *
 * For a heading, a stat tile or anywhere a column would otherwise wrap. Under
 * 10 000 zł it is `plnExact` without the grosze, because „1,4 tys. zł" hides
 * the difference between two contracts that differ by half their value.
 */
export function plnCompact(value: number | null | undefined): string {
  if (!isNumber(value)) return NOTHING;
  if (Math.abs(value) < COMPACT_FROM)
    return `${GROUPED.format(value)}${NBSP}zł`;
  return `${COMPACT.format(value)}${NBSP}zł`;
}

/**
 * The value of a contract that states one, or why it does not.
 *
 * A register entry can withhold its value - 766 of the 149 683 contracts in the
 * six weeks we hold do, under a named legal basis - and an empty cell there is
 * indistinguishable from a bug. `redacted` is deliberately separate from the
 * value being absent: five contracts carry the flag *and* a figure, so the two
 * have to be asked about independently rather than one inferred from the other.
 */
export function contractValueLabel(
  value: number | null | undefined,
  redacted: boolean | null | undefined,
): string {
  if (isNumber(value)) return plnExact(value);
  if (redacted) return "Utajniona";
  return "Bez podanej wartości";
}
