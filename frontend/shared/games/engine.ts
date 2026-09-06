/** What every daily game on /gry shares: a seeded random source, the day it is
 * keyed to, and the numbering that lets a share card say "#42".
 *
 * These started life inside `connections.ts`, which is where the first game
 * needed them. They are re-exported from there so nothing that already imports
 * them has to change, but new games take them from here - a game reaching into
 * another game for its random number generator is how two puzzles end up
 * accidentally sharing a seed.
 *
 * The whole point of seeding from the date is that no puzzle is ever stored:
 * every player asking for the same day gets the same board, and a day that
 * nobody played still has one. Anything that is not a pure function of
 * (game, date, the graph) does not belong in a generator.
 */

/** A 32-bit hash of a string, used to turn "gra:2026-09-02" into a seed. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** A small deterministic PRNG. Not cryptographic and does not need to be: the
 * answer travels to the client in the same response as the board on most of
 * these games, so seed secrecy was never what kept a puzzle honest. */
export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], rand: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** The random source for one game on one day.
 *
 * Keyed on the game as well as the date so that two games drawing from the
 * same pool on the same day do not draw the same thing - which they would, and
 * did, when both seeded on the date alone.
 */
export function dailyRandom(game: string, date: string): () => number {
  return mulberry32(hashSeed(`${game}:${date}`));
}

/** Today, as the day a Polish player would call it.
 *
 * Every daily rolls over at midnight in Warsaw rather than at UTC, because the
 * puzzle is dated in the reader's own terms. `en-CA` is the shortest way to an
 * ISO day out of `toLocaleDateString`; the locale is not user-visible.
 *
 * Takes the instant rather than reading the clock so that a caller can test
 * the rollover, and so that a server route and the page it renders can agree
 * on the day even if the request straddles midnight.
 */
export function warsawDay(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
}

/** Which puzzle of this game a date is, counting the first day as 1.
 *
 * Whole days apart rather than a difference of timestamps: both ends are ISO
 * days parsed at UTC midnight, so the division is exact, and `Math.round`
 * only has to absorb a leap second.
 */
export function puzzleNumber(firstDay: string, date: string): number {
  const days = (Date.parse(date) - Date.parse(firstDay)) / (24 * 3600 * 1000);
  return Math.round(days) + 1;
}

/** `count` items drawn from `pool` without replacement, deterministically.
 *
 * Sorts first, so the draw does not depend on the order Firestore happened to
 * return documents in - otherwise the same day yields a different board after
 * an ingest rewrites the collection, and a player who opens the page twice is
 * shown two different puzzles.
 */
export function pickDaily<T>(
  pool: readonly T[],
  key: (item: T) => string,
  rand: () => number,
  count: number,
): T[] {
  const sorted = [...pool].sort((a, b) => key(a).localeCompare(key(b)));
  return seededShuffle(sorted, rand).slice(0, count);
}

/** One item a day, dealt so that the whole pool goes round before anything
 * comes back.
 *
 * `pickDaily` draws each day independently, which is right when the pool is
 * large and the board is many items: a repeat is invisible inside sixteen
 * names. It is wrong when the day IS the item and the pool is small. Nine
 * candidates drawn independently repeat yesterday's answer about one day in
 * nine, and show only six distinct people across nine days - and a player who
 * gets the same person twice in a week does not conclude the pool is small,
 * they conclude the game is broken.
 *
 * So the pool is dealt rather than drawn: shuffled once per cycle, then walked
 * in order. Every item comes up exactly once per cycle, the order is different
 * each time round, and the cycle boundary is checked so that the last of one
 * lap and the first of the next are never the same item.
 *
 * `index` is the puzzle number, counting the game's first day as 1. Sorting
 * first, as `pickDaily` does, keeps the deal off whatever order Firestore
 * happened to return. Growing the pool reshuffles the future - which is
 * correct: a schedule nobody can see has nothing to be stable for.
 */
export function pickRotating<T>(
  pool: readonly T[],
  key: (item: T) => string,
  game: string,
  index: number,
): T | undefined {
  if (pool.length === 0) return undefined;
  const sorted = [...pool].sort((a, b) => key(a).localeCompare(key(b)));
  const size = sorted.length;
  const step = Math.max(index - 1, 0);
  const position = step % size;
  const cycle = Math.floor(step / size);

  /** Two items cannot be dealt without a boundary repeat half the time, and
   * the fix below would oscillate rather than resolve it, so a pool that small
   * is simply dealt in the same order every lap - which alternates perfectly. */
  if (size < 3) return sorted[position];

  const lap = (n: number) =>
    seededShuffle(sorted, mulberry32(hashSeed(`${game}#${n}`)));

  const order = lap(cycle);
  if (cycle > 0) {
    const previous = lap(cycle - 1);
    if (key(order[0]!) === key(previous[size - 1]!)) {
      // Swapped for the whole lap, not just for its first day, or the item
      // moved out of the way would be dealt twice.
      [order[0], order[1]] = [order[1]!, order[0]!];
    }
  }
  return order[position];
}
