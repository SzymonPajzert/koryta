import type { MissingReverseEdges } from "~~/server/api/edges/missingReverse.get";

/** A page of /api/edges/missingReverse, as the queue would find it on the real
 * site.
 *
 * The seed cannot produce one. Both of its `connection` edges are unnamed, so
 * they read "Powiązanie z" from either end, owe nothing and are correctly
 * absent from this queue - a plain capture would photograph the empty state.
 * Seeding named ties instead is what `tests/visual/fixtures/hospitalStats.ts`
 * argues against: the counts on the home page, the progress bar and
 * /eksploruj/statystyki are all drawn from the same world, so a row added for
 * one baseline turns the rest of the suite red.
 *
 * Typed off the endpoint's own export, so a change to the row shape breaks the
 * fixture rather than quietly drawing something the page no longer receives.
 *
 * The rows are chosen for the states the page has to tell apart:
 *
 * - "żona" and "była żona" reverse into exactly one word, so they are the two
 *   rows „Wypełnij oczywiste” counts.
 * - "ojciec" reverses into two the relation cannot choose between, and gets a
 *   chip each.
 * - "wspólnik" is symmetric - the first suggestion is the word itself - but it
 *   still offers a second, so it is not one of the obvious ones.
 * - "była żona" carries its modifier across, in the gender the reversed noun
 *   wants ("były mąż").
 * - "szara eminencja" is outside the vocabulary and gets no chips at all,
 *   which is the row a human has to think about.
 *
 * `published` differs across them because it is what the „na żywo” chip reads:
 * a live relation is printing the wrong word at somebody right now.
 */
export function missingReverseFixture(): MissingReverseEdges {
  return {
    edges: [
      {
        id: "rel-zona",
        name: "żona",
        sourceId: "1",
        sourceName: "Jan Kowalski",
        targetId: "3",
        targetName: "Anna Nowak",
        content: null,
        published: true,
      },
      {
        id: "rel-ojciec",
        name: "ojciec",
        sourceId: "4",
        sourceName: "Piotr Wiśniewski",
        targetId: "5",
        targetName: "Krzysztof Wójcik",
        content: "wspólne wpisy w KRS od 2011 roku",
        published: true,
      },
      {
        id: "rel-wspolnik",
        name: "wspólnik",
        sourceId: "sukadam",
        sourceName: "Adam Ustępujący",
        targetId: "sukcezary",
        targetName: "Cezary Obejmujący",
        content: null,
        published: false,
      },
      {
        id: "rel-byla-zona",
        name: "była żona",
        sourceId: "sukbarbara",
        sourceName: "Barbara Ustępująca",
        targetId: "sukedward",
        targetName: "Edward Poprzedni",
        content: null,
        published: true,
      },
      {
        id: "rel-eminencja",
        name: "szara eminencja",
        sourceId: "sukfranciszek",
        sourceName: "Franciszek Następny",
        targetId: "sukhanna",
        targetName: "Hanna Prokurent",
        content: null,
        published: false,
      },
    ],
    nextCursor: null,
    // Deliberately far above the five rows: the queue is a scan, and the shot
    // is also of the page admitting what it cost to find them.
    scanned: 1287,
    truncated: false,
  };
}
