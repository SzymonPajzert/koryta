/** Every game on /gry, in one list.
 *
 * The hub reads it to draw its cards, each game reads its own entry for the
 * puzzle numbering on the share card, and the end screen reads the others to
 * offer "inne gry na dziś". That last one is the reason this exists as data
 * rather than as markup on the hub page: the cross-promotion between dailies
 * is what turns several small games into one habit, and it only works if a
 * game added today appears at the bottom of every game added before it,
 * without anyone remembering to go and add the link.
 *
 * No icons here. This module is imported by server routes as well as by pages,
 * and pulling @mdi/js into the server bundle to draw a card is not worth it -
 * `app/utils/gameIcon.ts` maps a slug to its icon on the client side.
 */

export type GameStatus =
  /** Playable today. */
  | "live"
  /** Listed, greyed out, with no link. Kept in the registry so the hub can
   * show what is coming rather than pretending the section is finished. */
  | "soon";

export interface GameEntry {
  /** The whole of the URL: koryta.pl/gry/<slug>. Kept short and unaccented so
   * it survives being pasted into a group chat, which is where these are
   * actually shared. */
  slug: string;
  title: string;
  /** One line on the hub card - what you do, not why it is interesting. */
  tagline: string;
  /** The day this game's puzzle #1 was published. Puzzle numbers count from
   * it, so it is fixed once a game is live: moving it renumbers every share
   * card ever posted. */
  firstDay: string;
  status: GameStatus;
}

export const games: GameEntry[] = [
  {
    slug: "polaczenia",
    title: "Połączenia",
    tagline:
      "Pogrupuj 16 osób w cztery czwórki: wspólna partia, rok wyborów, region albo miejsce pracy. Masz cztery próby — jak w klasycznym Connections.",
    firstDay: "2026-07-27",
    status: "live",
  },
  {
    slug: "korytle",
    title: "Korytle",
    tagline:
      "Mozaika koryciarzy z jednego regionu Polski — podzielona według branż spółek i partii. Zgadnij, o które miasto chodzi; po każdej próbie podpowiemy odległość i kierunek.",
    firstDay: "2026-07-27",
    status: "live",
  },
  {
    slug: "studia",
    title: "Po jakich studiach?",
    tagline:
      "Anonimowe CV — praca i starty w wyborach. Zgadnij, co ta osoba skończyła. Po każdej próbie mówimy, jak blisko jesteś; zgadujesz do skutku.",
    firstDay: "2026-09-06",
    // Live on a small pool, deliberately. A day is one person, and on the
    // 2026-09-06 export nine people have an `education` that resolves and a CV
    // of at least three entries - so this game has nine dailies in it before it
    // starts over, against a register that already holds 638 published people
    // with CVs that long and no education on file. `pickRotating` is what makes
    // that a shipping decision rather than a bug: the pool is dealt round
    // before anything comes back, so nine people are nine distinct days rather
    // than nine draws that repeat one another every ninth day. Filling the
    // field on more people lengthens the cycle and needs no code change.
    status: "live",
  },
  {
    slug: "kiedy",
    title: "Kiedy?",
    tagline:
      "Sześć prawdziwych zmian na stanowiskach. Ktoś odszedł, ktoś przyszedł — a ty ustawiasz suwak na roku, w którym to się stało.",
    firstDay: "2026-09-02",
    status: "live",
  },
];

export const gamesBySlug = new Map(games.map((game) => [game.slug, game]));

/** The entry a game reads about itself. Throws rather than returning undefined:
 * every caller is a page that *is* one of these, so a miss is a typo in a slug
 * and not a case anybody should be writing a fallback for. */
export function gameEntry(slug: string): GameEntry {
  const entry = gamesBySlug.get(slug);
  if (!entry) throw new Error(`Nie ma gry o adresie /gry/${slug}`);
  return entry;
}

/** The other playable games, for the cross-promotion at the end of a daily. */
export function otherGames(slug: string): GameEntry[] {
  return games.filter((game) => game.slug !== slug && game.status === "live");
}
