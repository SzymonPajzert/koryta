import type { Edge, Person } from "./model";

/** How hard it is to check one person, from the outside.
 *
 * The queue at /eksploruj/nowe offers 9,074 unpublished people in one
 * undifferentiated list, ordered by a score. That order says who is most worth
 * looking at; it says nothing about what looking at them would take, and the
 * two are not the same question. A volunteer with ten minutes and no training
 * can settle somebody whose Wikipedia article states a date of birth; nobody
 * can settle a person whose whole file is one register row, however high they
 * rank.
 *
 * The tiers are what a person *can* be checked with, in ascending order of
 * what it costs the reader, and a person is filed under the cheapest one they
 * qualify for. Measured against the 2026-09-19 export: 407 people in tier 1,
 * 859 in tier 2 and 1,320 in tier 3, with 6,488 in none of them.
 */
export const queueTiers = [1, 2, 3] as const;

export type QueueTier = (typeof queueTiers)[number];

/** What each tier is, in the words the queue and /pomoc both use.
 *
 * Here rather than on the page because two of them render it - the card on
 * /pomoc that hands out the task, and the filter on /eksploruj/nowe the card
 * links into - and a reader who follows the link has to land on the same task
 * they were offered. `what` is the job itself; `needs` is what it costs them,
 * which is the whole reason the tiers are ordered.
 */
export const queueTierCopy: Record<
  QueueTier,
  { title: string; what: string; needs: string }
> = {
  1: {
    title: "Wikipedia obok rejestru",
    what:
      "Osoba ma i biogram na Wikipedii, i wpis w rejestrze. Porównujesz datę " +
      "urodzenia z jednego i drugiego, sprawdzasz, czy region się zgadza, i " +
      "wypisujesz partię z biogramu.",
    needs: "Wystarczy sam biogram - niczego nie trzeba szukać poza nim.",
  },
  2: {
    title: "Wygrana w wyborach, czyli oświadczenie majątkowe",
    what:
      "Osoba w ostatnich dziesięciu latach zdobyła mandat i ma świeżą posadę " +
      "w spółce albo instytucji publicznej. Z mandatu bierze się oświadczenie " +
      "majątkowe - znajdujesz je w BIP-ie urzędu i porównujesz datę urodzenia " +
      "z tą z rejestru.",
    needs: "Trzeba wejść do BIP-u urzędu i znaleźć w nim oświadczenie.",
  },
  3: {
    title: "Fakty wyciągnięte z artykułów",
    what:
      "Model wyciągnął z tekstów zdania o partii, znajomości albo posadzie " +
      "tej osoby. Czytasz artykuł, z którego pochodzi zdanie, i mówisz, czy " +
      "model trafił.",
    needs: "Trzeba przeczytać źródło - to najdłuższa robota z tych trzech.",
  },
};

/** A win older than this is not what the tier is about.
 *
 * The point of tier 2 is that a recent win leaves a paper trail a reader can
 * follow - an oświadczenie majątkowe, filed yearly for the term and published
 * by the office - so the window is the one over which those filings are still
 * online, not a claim about how long a career lasts. */
const WIN_WINDOW_YEARS = 10;

/** How recent the public post has to be to pair with that win.
 *
 * Arbitrary in the way the window above is not: it is there to keep the tier
 * to people whose post and whose mandate plausibly overlap, rather than to
 * pair a 2024 council seat with a directorship that ended in 2009. */
const POST_WINDOW_YEARS = 5;

/** The kinds of extracted fact that give a reader something to check.
 *
 * Every one of them names something outside the register: the party somebody
 * joined, the person they are related to, the affair they turn up in, the post
 * an article says they hold. A fact of another kind - or none at all - leaves
 * the reader with the register row they already had.
 */
const CHECKABLE_FACT_TYPES = new Set([
  "party_membership",
  "personal_relation",
  "affair_involvement",
  "employment",
]);

function isoYearsAgo(now: Date, years: number): string {
  const then = new Date(now);
  then.setFullYear(then.getFullYear() - years);
  return then.toISOString().slice(0, 10);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Whether the person holds, or recently held, a post at a company somebody
 * has shown to be publicly owned.
 *
 * An open-ended post counts however old its start: `end_date` is absent
 * because nobody has left, which is the strongest version of "current" the
 * register offers. */
function publicPost(
  edges: Edge[],
  publicPlaceIds: ReadonlySet<string>,
  since?: string,
): boolean {
  return edges.some((edge) => {
    if (edge.type !== "employed" || !publicPlaceIds.has(edge.target)) {
      return false;
    }
    if (!since) return true;
    return !hasText(edge.end_date) || edge.end_date! >= since;
  });
}

/** Which tier this person belongs in, or 0 for none of them.
 *
 * Deliberately ordered rather than a set of independent flags: a person is
 * offered once, in the queue that is cheapest to work, and 219 of the tier-1
 * people also have facts while 100 of them also won something recently.
 * Showing each of them three times would make the three counts on /pomoc add
 * up to more people than exist.
 *
 * @param factTypes `fact_type` of every extraction matched to this person.
 */
export function queueTier(
  person: Pick<Person, "wikipedia" | "rejestrIo">,
  edges: Edge[],
  publicPlaceIds: ReadonlySet<string>,
  factTypes: Iterable<string>,
  now: Date = new Date(),
): QueueTier | 0 {
  // Tier 1: a biography and a register entry, side by side. The reader
  // compares a date of birth and a region, and reads the party off the
  // article - no source they have to find for themselves.
  if (hasText(person.wikipedia) && hasText(person.rejestrIo)) return 1;

  // Tier 2: a mandate won inside the window, and a public post inside the
  // shorter one. The win is what makes the oświadczenie majątkowe exist, and
  // the declaration is what carries the date of birth to compare against the
  // register.
  //
  // `elected` is written for a win and never for a defeat - see `elected` in
  // shared/api.ts - so this reads a bare `true` rather than distinguishing
  // false from absent, both of which mean nobody said.
  const winSince = isoYearsAgo(now, WIN_WINDOW_YEARS);
  const wonRecently = edges.some(
    (edge) =>
      edge.type === "election" &&
      edge.elected === true &&
      hasText(edge.start_date) &&
      edge.start_date! >= winSince,
  );
  if (
    wonRecently &&
    publicPost(edges, publicPlaceIds, isoYearsAgo(now, POST_WINDOW_YEARS))
  ) {
    return 2;
  }

  // Tier 3: a fact somebody has to read an article to settle. Anchored on a
  // public post or on a candidacy, because that is what makes the fact worth
  // an evening: the model pulls sentences about anybody a piece of text names,
  // and a party membership tells the site nothing about a person who holds no
  // public post.
  const anchored =
    publicPost(edges, publicPlaceIds) ||
    edges.some((edge) => edge.type === "election");
  if (!anchored) return 0;
  for (const factType of factTypes) {
    if (CHECKABLE_FACT_TYPES.has(factType)) return 3;
  }

  return 0;
}
