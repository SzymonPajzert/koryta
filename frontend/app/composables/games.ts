import { warsawDay } from "~~/shared/games/engine";

/** The plumbing every daily on /gry repeats: which day it is, fetching that
 * day's puzzle, remembering how far the player got, and putting a result in
 * the clipboard.
 *
 * Both of the first two games had their own copy of all four, which is how
 * Połączenia ended up storing progress under a key Korytle could not read and
 * why only one of them survived a corrupted `localStorage` entry. None of this
 * is game-specific: what differs between games is the shape of the progress,
 * which is why `useGameProgress` takes a reviver rather than a schema.
 */

/** The day the games are on, in the reader's own terms.
 *
 * Read once per page rather than per component: two components computing it a
 * few milliseconds apart either side of Warsaw midnight would fetch one day's
 * puzzle and store progress under the other's key.
 */
export function useGameDay(): string {
  return useState("games:day", () => warsawDay()).value;
}

/** Today's puzzle for one game.
 *
 * `useFetch` rather than `$fetch` so the board is server rendered - these
 * pages are shared as links, and a puzzle that only appears after hydration
 * has nothing for a crawler or a link preview to show.
 */
export function useDailyPuzzle<T>(path: string) {
  const day = useGameDay();
  const { data, pending, error } = useFetch<T>(path, {
    query: { date: day },
  });
  return { day, puzzle: data, pending, error };
}

/** Progress through today's puzzle, kept in `localStorage`.
 *
 * Deliberately not on the server. A daily is not worth a write per guess, and
 * a player who has to be signed in to keep their streak is a player who does
 * not play - the account upgrade path (anonymous auth, then linking) is a
 * later problem, and this shape does not block it.
 *
 * `revive` is the game's own validation of what it reads back. It matters more
 * than it looks: the stored blob outlives the code that wrote it, so a board
 * whose ids have since changed, or a half-written entry from a tab that was
 * closed mid-write, arrives here as something the game must be able to reject.
 * Returning null from `revive` means "start today over", which is always safe.
 */
export function useGameProgress<S>(
  slug: string,
  day: string,
  initial: () => S,
  revive: (stored: unknown) => S | null,
) {
  const key = `koryta:gry:${slug}`;
  const state = ref<S>(initial()) as Ref<S>;
  /** Until the stored value has been read, nothing is written back - otherwise
   * the empty initial state overwrites a game in progress before `onMounted`
   * has had a chance to load it. */
  const loaded = ref(false);

  onMounted(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      if (stored && stored.date === day) {
        const revived = revive(stored.state);
        if (revived !== null) state.value = revived;
      }
    } catch {
      // Unparseable, so there is nothing to resume. Today starts over.
    }
    loaded.value = true;
  });

  watch(
    state,
    (value) => {
      if (!import.meta.client || !loaded.value) return;
      try {
        localStorage.setItem(key, JSON.stringify({ date: day, state: value }));
      } catch {
        // Private mode, or a full quota. Losing progress is better than losing
        // the move that was being made when it filled up.
      }
    },
    { deep: true },
  );

  return state;
}

/** Handing a result to whatever the player shares things with.
 *
 * `navigator.share` where it exists - on a phone, which is where a daily is
 * played - and the clipboard everywhere else. The DOM types claim `share` is
 * always there; on desktop Firefox and Chrome it is not, hence the `in` check
 * rather than an optional call.
 */
export async function shareGameResult(text: string): Promise<
  /** What to tell the player, or null where the sheet handled it silently. */
  string | null
> {
  // Typed off the runtime rather than off the DOM lib, which declares `share`
  // unconditionally - so `"share" in navigator` narrows the other branch to
  // `never` and the clipboard call stops compiling.
  const nav = navigator as Navigator & {
    share?: (data: { text: string }) => Promise<void>;
  };
  try {
    if (typeof nav.share === "function") {
      await nav.share({ text });
      return null;
    }
    await nav.clipboard.writeText(text);
    return "Wynik skopiowany do schowka.";
  } catch {
    // Includes the player dismissing the share sheet, which is not an error
    // worth a message - but the two are indistinguishable here.
    return "Nie udało się udostępnić wyniku.";
  }
}

/** The last line of every share card: the game's own address.
 *
 * Absolute, because the text is pasted somewhere that has no idea what site it
 * came from - which is the entire reason to share it.
 */
export function gameShareUrl(slug: string): string {
  return `https://koryta.pl/gry/${slug}`;
}
