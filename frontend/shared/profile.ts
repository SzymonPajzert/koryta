/** Whether a contributor is willing to be named in public, and what everybody
 * else is shown instead.
 *
 * The ranking on /eksploruj/statystyki used to be admin-only, on the same
 * reasoning that makes `/api/users/lookup` admin-only: a display name is
 * somebody's real name, and nobody signed up to have theirs listed next to what
 * they have been reading. That reasoning still holds for anyone who has not
 * said otherwise - so the ranking is public and the names in it are not, until
 * the person whose name it is turns `publicProfile` on from /profil. The same
 * choice decides who is named on /aktywnosc.
 *
 * Kept here rather than in the endpoint so the switch on /profil, the server
 * that applies it and the table that renders the result are all written against
 * one description of what the setting means.
 */

/** What a user who has never opened their settings gets.
 *
 * Off, unlike the two notification kinds: those are the outcome of something
 * the recipient did and are addressed to them alone, while this publishes a
 * name to everyone who opens the page. A default that shares something has to
 * be chosen, not inherited.
 */
export const publicProfileDefault = false;

/** How the switch reads on /profil.
 *
 * /aktywnosc names people by the same choice, and it shows more than the
 * ranking does: what somebody rated, noted or proposed, and when. Agreeing to
 * a line in a ranking is not agreeing to that, so the switch says both.
 */
export const publicProfileLabel = {
  title: "Pokaż moją nazwę w statystykach i w aktywności",
  hint:
    "Twoja nazwa użytkownika pojawi się w rankingu na /eksploruj/statystyki " +
    "i na stronie Aktywność, przy tym, co i kiedy oceniasz, notujesz lub " +
    "proponujesz. Bez tego inni widzą w rankingu zamazaną nazwę, a w " +
    "aktywności „Anonim”. Administratorzy widzą Twoją nazwę niezależnie od " +
    "tego ustawienia.",
};

export function publicProfileEnabled(
  choice: boolean | undefined | null,
): boolean {
  return choice === undefined || choice === null
    ? publicProfileDefault
    : choice;
}

/** How many bullets stand in for a hidden name.
 *
 * Fixed, rather than one per hidden character: the length of somebody's name is
 * itself an identifier in a contributor pool this size, and a row that is three
 * bullets wide next to one that is eleven narrows it a long way before anybody
 * has guessed a letter.
 */
const MASK = "•".repeat(5);

/**
 * The name to print for a contributor who has not made their profile public.
 *
 * The first letter survives and nothing else does. That is a deliberate middle:
 * a row reading `A•••••` says a person is behind it - which is the whole point
 * of showing the ranking to volunteers - while a row reading `Uczestnik #4`
 * reads as a slot in a table. The initial is the price of that, and it is the
 * only thing about the account that leaves the server: `/api/stats/activity`
 * never sends a non-admin the uid, the email or the avatar of anyone who has
 * not opted in.
 *
 * `rank` names the row when there is no display name to take a letter from -
 * plenty of accounts have never set one - so every row is labelled either way.
 */
export function maskedContributorName(
  displayName: string | null | undefined,
  rank: number,
): string {
  const initial = Array.from(displayName?.trim() ?? "")[0];
  return initial ? `${initial}${MASK}` : `Uczestnik #${rank}`;
}
