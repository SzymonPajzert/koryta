/** REGON and NIP: the identifiers an institution outside KRS still has.
 *
 * A ministry, an urząd or a wojewódzki fundusz has no entry in the Krajowy
 * Rejestr Sądowy, so `Company.krsNumber` is empty for all of them and there is
 * nothing to name them by. Both of these registers do cover them, and both
 * carry a check digit, so a typo can be caught here rather than stored as a
 * plausible-looking number nobody can look up.
 */

export type CompanyIdentifier = {
  register: string;
  value: string;
  /** Where the register itself lists this number, when it has such a page. */
  url?: string;
};

/** The entry rejestr.io publishes for a KRS number.
 *
 * It addresses a company by the number alone: the readable slug its own links
 * carry ("/krs/348888/nowa-energia") is decorative, and a number padded to the
 * official ten digits resolves the same as a bare one - so neither the
 * company's name nor the shape of the stored number has to be right for the
 * link to land. REGON and NIP have no comparable public page. */
function registerUrl(register: string, value: string): string | undefined {
  if (register !== "KRS") return undefined;
  const digits = value.replace(/[\s-]/g, "");
  return /^\d+$/.test(digits) ? `https://rejestr.io/krs/${digits}` : undefined;
}

/** The registers a place is listed in, most specific first, skipping the ones
 * it has no number for. An institution outside KRS is left with REGON and NIP,
 * and showing nothing at all would leave a reader no way to check who it is. */
export function companyIdentifiers(company: {
  krsNumber?: string;
  regonNumber?: string;
  nipNumber?: string;
}): CompanyIdentifier[] {
  return [
    { register: "KRS", value: company.krsNumber },
    { register: "REGON", value: company.regonNumber },
    { register: "NIP", value: company.nipNumber },
  ]
    .filter(
      (entry): entry is { register: string; value: string } => !!entry.value,
    )
    .map((entry) => ({
      ...entry,
      url: registerUrl(entry.register, entry.value),
    }));
}

/** The register entry a rejestr.io link names: its number, where it has one.
 *
 * The pipelines send `https://rejestr.io/osoby/<number>`. A link pasted from a
 * browser carries the person's name after the number, or a trailing slash, and
 * 10 published pages store one of those. Read as written, eight of them looked
 * linked to some other entry than the payloads the 10-06 run had for them,
 * which named the very same number. Anything else is compared as written.
 *
 * Here rather than in the people import, where it was written, because the
 * declarations automation asks the same question of a page's birth date: did
 * it come with the entry the page's jobs are listed under
 * (server/utils/declarationPublish.ts).
 */
export function registerEntry(link: unknown): string | undefined {
  if (typeof link !== "string" || !link) return undefined;
  return /rejestr\.io\/osoby\/(\d+)/.exec(link)?.[1] ?? link;
}

/** Digits of an identifier as typed, with the separators people use.
 *
 * Both numbers are habitually written in groups ("123-456-32-18", "000 000 000")
 * and a NIP is prefixed with the country code on invoices, none of which is
 * part of the number. */
function digitsOf(raw: string, stripCountryCode: boolean): string {
  const trimmed = raw.trim().toUpperCase();
  const bare =
    stripCountryCode && trimmed.startsWith("PL") ? trimmed.slice(2) : trimmed;
  return bare.replace(/[\s-]/g, "");
}

export function normalizeNip(raw: string): string {
  return digitsOf(raw, true);
}

export function normalizeRegon(raw: string): string {
  return digitsOf(raw, false);
}

/** The weighted-sum check both registers use, modulo 11.
 *
 * REGON reads a remainder of 10 as a check digit of 0; NIP has no such digit,
 * and a number whose remainder is 10 is simply not a NIP - `tenIsZero` is which
 * of the two this is. */
function checkDigit(
  digits: string,
  weights: number[],
  tenIsZero: boolean,
): number | null {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += Number(digits[i]) * weights[i]!;
  }
  const remainder = sum % 11;
  if (remainder === 10) return tenIsZero ? 0 : null;
  return remainder;
}

/** Whether a NIP is well formed: ten digits ending in their check digit. */
export function isValidNip(raw: string): boolean {
  const digits = normalizeNip(raw);
  if (!/^\d{10}$/.test(digits)) return false;
  const expected = checkDigit(digits, [6, 5, 7, 2, 3, 4, 5, 6, 7], false);
  return expected !== null && expected === Number(digits[9]);
}

/** Whether a REGON is well formed.
 *
 * Nine digits identify the entity itself; a fourteen-digit one identifies a
 * local unit of it and starts with the entity's own nine, which have to check
 * out too - so a mistyped digit in the first half cannot hide behind the
 * second check digit. */
export function isValidRegon(raw: string): boolean {
  const digits = normalizeRegon(raw);
  if (!/^\d{9}$/.test(digits) && !/^\d{14}$/.test(digits)) return false;

  const nine = checkDigit(digits, [8, 9, 2, 3, 4, 5, 6, 7], true);
  if (nine !== Number(digits[8])) return false;
  if (digits.length === 9) return true;

  const fourteen = checkDigit(
    digits,
    [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8],
    true,
  );
  return fourteen === Number(digits[13]);
}
