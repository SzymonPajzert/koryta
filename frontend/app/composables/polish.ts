export interface PolishNoun {
  nominative: string;
  genitive: string;
  dative: string;
  accusative: string;
  instrumental: string;
  locative: string;
}

/** Which of the three nominative forms a count takes. Split out of
 * `polishCounting` so that the grouped variant below picks the noun by the
 * same rule; two copies of it would answer „1 284 osoba” the first time one of
 * them was corrected and the other was not. */
function nominativeNoun(
  number: number,
  form_singular: string,
  form_plural: string,
  form_genitive: string,
): string {
  const n = Math.abs(number) % 100;
  const n1 = n % 10;
  // dopełniacz dla naście
  if (n > 10 && n < 20) return form_genitive;
  if (n1 > 1 && n1 < 5) return form_plural;
  // Only a bare one takes the singular. This used to be `n1 === 1`, which is
  // the rule for the *last digit* rather than for the number, and it wrote
  // „21 osoba”, „101 osoba” and - the one that found it - „371 rocznica” on
  // a page counting them. `polishCountingGenitive` has said so in its own
  // docstring since it was written: everything but a bare one takes the
  // plural, „21 osób” included.
  if (Math.abs(number) === 1) return form_singular;
  return form_genitive;
}

export function polishCounting(
  number: number,
  form_singular: string,
  form_plural: string,
  form_genitive: string,
): string {
  return `${number} ${nominativeNoun(number, form_singular, form_plural, form_genitive)}`;
}

/** A figure with its thousands grouped, „1 284” rather than „1284”.
 *
 * `Intl` alone does not do it: CLDR's Polish locale starts grouping at five
 * digits, and the counts this is written for - how many people a filtered
 * table holds - sit in the four-digit range it skips. The separator is a
 * non-breaking space, so a number never wraps between „1” and „284”.
 */
export function polishNumber(number: number): string {
  return new Intl.NumberFormat("pl-PL", { useGrouping: true }).format(number);
}

/** A count after a preposition that takes the genitive: „z 1 284 osób”, „z 1
 * osoby”.
 *
 * `polishCounting` returns the nominative, so in that position it writes
 * „sprawdzono 645 z 1284 osoby” - a case error at every count ending in 2-4.
 * It also glues the raw number to the noun, which leaves nowhere to group the
 * thousands; this one does group them, while `polishCounting` cannot start
 * without moving a dozen sentences and two visual baselines.
 *
 * Two forms and not three: outside the nominative the numeral stops choosing a
 * noun form, so everything but a bare one takes the plural, „21 osób”
 * included.
 */
export function polishCountingGenitive(
  number: number,
  form_singular: string,
  form_plural: string,
): string {
  const noun = Math.abs(number) === 1 ? form_singular : form_plural;
  return `${polishNumber(number)} ${noun}`;
}

/** `polishCounting` with the thousands grouped: „1 284 osoby”.
 *
 * The query bar prints this figure a centimetre above the work row's
 * „sprawdzono 645 z 1 284 osób”, and an ungrouped „1284 osoby” beside it reads
 * as a different number rather than as the same one in another case.
 * `polishCounting` itself cannot start grouping: it is printed by a dozen
 * captions and two visual baselines whose width would move with it.
 */
export function polishCountingGrouped(
  number: number,
  form_singular: string,
  form_plural: string,
  form_genitive: string,
): string {
  return `${polishNumber(number)} ${nominativeNoun(number, form_singular, form_plural, form_genitive)}`;
}
