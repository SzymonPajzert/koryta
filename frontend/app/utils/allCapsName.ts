/** Whether a name is written in capitals, the way the register writes most
 * companies: „PKP LINIA HUTNICZA SZEROKOTOROWA (Zamość)”.
 *
 * The town the site appends in brackets is mixed case and is left out of the
 * count, and so is anything that is not a letter. Mostly capitals rather than
 * all of them, because a register name keeps its „Sp. z o.o.” and „im.” in
 * lower case. Decided by the capitals, not by the length: „ORLEN (Płock)”
 * and „PKP” are names in capitals too, and the redesign's rule is one step
 * down for every one of them.
 */
export function isAllCapsName(name: string | undefined): boolean {
  const letters = (name ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  return upper / letters.length > 0.7;
}
