import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import type { Edge } from "~~/shared/model";
import { educationIndex } from "~~/shared/games/education";
import { educationVocabulary } from "~~/shared/games/educationVocabulary";
import {
  pickStudiaTarget,
  type StudiaEdgeLike,
  type StudiaTarget,
} from "~~/shared/games/studia";

/** Today's target, read out of Firestore.
 *
 * The choosing itself is `pickStudiaTarget` in shared/games/studia.ts, which
 * takes plain records; this is only the part that has to touch a database.
 * Both routes of the game go through here so that the CV route and the guess
 * route cannot disagree about who today is.
 *
 * CACHED, and that is not an optimisation. A guess costs a request, the
 * vocabulary is the number of distinct guesses a day can hold, and every one
 * of those requests would otherwise call `fetchEdges()` - a read of the entire
 * edges collection, which /api/stats/hospitals already names as one of the
 * most expensive things this backend does. Cached per day, the whole game
 * costs one such read a day instead of one per distinct term.
 */
const cachedStudiaTarget = defineCachedFunction(
  async (day: string): Promise<StudiaTarget | null> => {
    const index = educationIndex(educationVocabulary);

    const [people, places, regions, edges] = await Promise.all([
      fetchNodes("person"),
      fetchNodes("place"),
      fetchNodes("region"),
      fetchEdges(),
    ]);

    return pickStudiaTarget(
      Object.values(people),
      edges as unknown as (Edge & StudiaEdgeLike)[],
      places,
      regions,
      index,
      day,
    );
  },
  {
    maxAge: 21600, // 6 hours, as the routes that call it are cached for
    name: "studiaTarget",
    getKey: (day: string) => day,
  },
);

export async function dailyStudiaTarget(
  day: string,
): Promise<StudiaTarget | null> {
  return cachedStudiaTarget(day);
}

export type { StudiaTarget };
