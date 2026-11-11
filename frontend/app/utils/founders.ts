/** What a founder relation is called on a company page, read from either end.
 *
 * A foundation or an association holds no shares, so the body behind it is its
 * founder: an `owns` edge marked `founder` (see `Edge.founder`). The words
 * agree with the body's legal form, which the register gives as
 * `Company.legalForm`, and with its name where the register gave no form. */

type Body = { legalForm?: string; name?: string } | undefined;

function form(body: Body): string {
  return (body?.legalForm || body?.name || "").toUpperCase();
}

/** The founder, on the founded body's page: „Fundator” of a foundation, as
 * the law on foundations names one, and „Założyciel” of anything else, a
 * sports association or an employers' union. */
export function founderNoun(body: Body): "Fundator" | "Założyciel" {
  return /\bFUNDACJ/.test(`${form(body)} ${(body?.name ?? "").toUpperCase()}`)
    ? "Fundator"
    : "Założyciel";
}

/** The founded body, on its founder's page, in the gender of its form: a
 * fundacja is „założona”, a stowarzyszenie „założone”, a związek „założony”. */
export function foundedParticiple(body: Body): string {
  const text = form(body);
  if (text.startsWith("STOWARZYSZENIE")) return "założone";
  if (text.startsWith("ZWIĄZEK")) return "założony";
  return "założona";
}
