/** Daily "Kiedy?": six real changes of seat, and a slider.
 *
 * A card shows who left a post and who took it over - the register's own
 * handover, drawn by the same component a person's page uses - with the terms
 * blanked. The player answers with a year.
 *
 * This module is pure: which handovers exist is worked out in
 * server/api/games/kiedy.get.ts, from the same `shared/succession.ts` pairing
 * the site shows on a profile. Nothing here reads Firestore, so the scoring
 * and the pick are testable without one.
 */

import { dailyRandom, pickDaily, puzzleNumber } from "./engine";

export const kiedySlug = "kiedy";

/** How many rounds a day is. Six because that is what a bounded session looks
 * like on a phone - long enough to warm up on the first card and still be
 * played on the way to work. */
export const kiedyRounds = 6;

/** The window the slider spans.
 *
 * The lower bound is not a round number by accident: the register's own
 * coverage falls off a cliff before the 2000s, and a slider that starts at
 * 1989 spends half its travel on years that never hold an answer, which makes
 * every guess feel like a coin flip. Anything older is left out of the pool
 * rather than squeezed onto the axis.
 */
export const kiedyFirstYear = 2000;

/** One handover to be placed in time.
 *
 * Everything a card needs and nothing that would give the year away: no dates,
 * no urls. `answer` is the year the arriving spell began.
 */
export interface KiedySwap {
  /** Stable across refetches - progress is stored against it. Built from the
   * two edge ids, which is what makes a handover unique. */
  id: string;
  companyName: string;
  role: string;
  /** Days between the two filings; negative where they overlap. Shown as the
   * card's middle pill, and it says nothing about *when*. */
  gapDays: number;
  /** How many seats of this role changed hands here that day. Above one, the
   * card has to admit the pairing picked one assignment out of several. */
  batchSize: number;
  left: KiedySide;
  joined: KiedySide;
  /** The year to be guessed. */
  answer: number;
}

export interface KiedySide {
  name: string;
  parties: string[];
}

export interface KiedyPuzzle {
  date: string;
  number: number;
  swaps: KiedySwap[];
  firstYear: number;
  lastYear: number;
}

export function kiedyPuzzleNumber(firstDay: string, date: string): number {
  return puzzleNumber(firstDay, date);
}

/** Points for one guess.
 *
 * Full marks for the year, and nothing at all five years out. Linear in
 * between rather than something cleverer, because the player has to be able to
 * predict it from the feedback on the previous card: "two years off cost me
 * forty" is a rule you can play against, and a curve is not.
 */
export const kiedyMaxPoints = 100;
const pointsLostPerYear = 20;

export function kiedyPoints(guess: number, answer: number): number {
  const off = Math.abs(guess - answer);
  return Math.max(0, kiedyMaxPoints - off * pointsLostPerYear);
}

/** The square one round contributes to the share card.
 *
 * Four buckets, not five: a share grid is read at a glance in a group chat,
 * and a scale finer than "spot on / close / nearly / no" stops being legible
 * at emoji size.
 */
export function kiedySquare(guess: number, answer: number): string {
  const off = Math.abs(guess - answer);
  if (off === 0) return "🟩";
  if (off === 1) return "🟨";
  if (off <= 3) return "🟧";
  return "⬜";
}

/** How a round's result reads once the answer is out. */
export function kiedyVerdict(guess: number, answer: number): string {
  const off = Math.abs(guess - answer);
  if (off === 0) return "Dokładnie!";
  const years = off === 1 ? "rok" : off < 5 ? "lata" : "lat";
  const direction = guess < answer ? "za wcześnie" : "za późno";
  return `O ${off} ${years} ${direction}.`;
}

/** The six handovers of one day.
 *
 * Deterministic in the date, so a player who reloads gets the same six and a
 * day nobody played still has its own. Sorted by id inside `pickDaily` so the
 * draw does not move when an ingest rewrites the collection.
 */
export function pickKiedySwaps(
  date: string,
  pool: readonly KiedySwap[],
  rounds = kiedyRounds,
): KiedySwap[] {
  const rand = dailyRandom(kiedySlug, date);
  return pickDaily(pool, (swap) => swap.id, rand, rounds);
}

/** Whether a handover is fit to be asked about.
 *
 * The pairing is deliberately generous, because a page that shows a probable
 * predecessor is more use than one that shows none. A quiz is not: an answer
 * the register only half supports is a card the player cannot win, so the bar
 * here is higher than the bar for the profile.
 */
export function kiedyIsAskable(
  swap: Pick<KiedySwap, "companyName" | "role" | "left" | "joined" | "answer">,
  lastYear: number,
): boolean {
  if (!swap.companyName.trim() || !swap.role.trim()) return false;
  if (!swap.left.name.trim() || !swap.joined.name.trim()) return false;
  return swap.answer >= kiedyFirstYear && swap.answer <= lastYear;
}
